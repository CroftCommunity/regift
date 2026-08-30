import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPost, regiftVideo, NeedsBrowserError } from '../../src/core/pipeline';
import { CourierBlockedError, type Courier, type Muxer } from '../../src/core/ports';

const mpd = readFileSync(new URL('../fixtures/reddit/dash-manifest.mpd', import.meta.url), 'utf8');
const postJson = readFileSync(new URL('../fixtures/reddit/post-video.json', import.meta.url), 'utf8');

const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A courier that can read v.redd.it (as a page can) and, optionally, reddit.com. */
function fakeCourier(opts: { readonly readsReddit: boolean; readonly log?: string[] }): Courier {
  return {
    canRead: (url) => new URL(url).hostname === 'v.redd.it' || (opts.readsReddit && new URL(url).hostname.endsWith('reddit.com')),
    text: (url) => {
      opts.log?.push(url);
      if (url.endsWith('DASHPlaylist.mpd')) return Promise.resolve(mpd);
      if (url.includes('.json')) return Promise.resolve(postJson);
      return Promise.reject(new Error(`unexpected text read ${url}`));
    },
    bytes: (url) => {
      opts.log?.push(url);
      return Promise.resolve(bytesOf(url.split('/').pop() ?? ''));
    },
  };
}

const recordingMuxer = (calls: unknown[]): Muxer => ({
  mux: (input) => {
    calls.push(input);
    return Promise.resolve(bytesOf('muxed'));
  },
  tag: (video) => Promise.resolve(video),
});

describe('readPost', () => {
  it('a /s/ share link is handed back to the browser to resolve', async () => {
    await expect(readPost('https://www.reddit.com/r/x/s/AbC', fakeCourier({ readsReddit: true }))).rejects.toBeInstanceOf(
      NeedsBrowserError,
    );
  });

  it('a post URL the courier cannot read is reported as blocked, naming the URL to open by hand', async () => {
    const err = await readPost(
      'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/?utm=1',
      fakeCourier({ readsReddit: false }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CourierBlockedError);
    expect((err as CourierBlockedError).url).toBe(
      'https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/.json?limit=0&raw_json=1',
    );
  });

  it('reads and parses the post when the courier can reach reddit.com', async () => {
    const post = await readPost('https://old.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes', fakeCourier({ readsReddit: true }));
    expect(post.video?.id).toBe('blke7z3ttolh1');
  });

  it('a v.redd.it link needs no post read at all', async () => {
    const post = await readPost('https://v.redd.it/abc123', fakeCourier({ readsReddit: false }));
    expect(post.video?.id).toBe('abc123');
    expect(post.title).toBeNull();
  });

  it('rejects a URL it does not understand', async () => {
    await expect(readPost('https://example.com/', fakeCourier({ readsReddit: true }))).rejects.toThrow(/not a reddit/i);
  });
});

describe('regiftVideo', () => {
  it('reads the manifest, fetches the chosen tracks, muxes, and names the file', async () => {
    const log: string[] = [];
    const muxCalls: unknown[] = [];
    const stages: string[] = [];
    const out = await regiftVideo({
      videoId: 'blke7z3ttolh1',
      courier: fakeCourier({ readsReddit: false, log }),
      muxer: recordingMuxer(muxCalls),
      maxHeight: 854,
      onStage: (s) => stages.push(s),
    });
    expect(log).toEqual([
      'https://v.redd.it/blke7z3ttolh1/DASHPlaylist.mpd',
      'https://v.redd.it/blke7z3ttolh1/CMAF_480.mp4',
      'https://v.redd.it/blke7z3ttolh1/CMAF_AUDIO_128.mp4',
    ]);
    expect(muxCalls).toEqual([{ video: bytesOf('CMAF_480.mp4'), audio: bytesOf('CMAF_AUDIO_128.mp4') }]);
    expect(out.bytes).toEqual(bytesOf('muxed'));
    expect(out.filename).toBe('regift-blke7z3ttolh1.mp4');
    expect(stages).toEqual(['manifest', 'video', 'audio', 'mux', 'done']);
  });

  it('skips the mux when the manifest has no audio — the video track is already a playable mp4', async () => {
    const muxCalls: unknown[] = [];
    const silentCourier: Courier = {
      ...fakeCourier({ readsReddit: false }),
      text: () => Promise.resolve(mpd.replace(/<AdaptationSet contentType="audio"[\s\S]*?<\/AdaptationSet>/, '')),
    };
    const out = await regiftVideo({ videoId: 'v1', courier: silentCourier, muxer: recordingMuxer(muxCalls) });
    expect(muxCalls).toEqual([]);
    expect(out.bytes).toEqual(bytesOf('CMAF_720.mp4'));
  });
});

describe('regiftVideo: tags reach the muxer', () => {
  it('passes the container tags through untouched', async () => {
    const muxCalls: unknown[] = [];
    const tags = { title: 'Dad jokes', artist: 'u/someredditor', comment: 'via u/someredditor on r/GuysBeingDudes — https://r/x' };
    await regiftVideo({ videoId: 'blke7z3ttolh1', courier: fakeCourier({ readsReddit: false }), muxer: recordingMuxer(muxCalls), tags });
    expect(muxCalls[0]).toMatchObject({ tags });
  });
});
