// The spine: a shared link → a post → its tracks → one playable file. Two
// functions rather than one, because the shell decides how it obtained the post
// (the courier read it, or the person pasted the JSON after the courier was
// blocked) and then hands the video id to the second half either way.
import { CourierBlockedError, type Courier, type Muxer } from './ports';
import { classifyRedditLink, postJsonUrl } from './reddit/link';
import { parsePostListing, type RedditPost } from './reddit/post';
import { manifestUrl, parseDashManifest, pickTracks, trackUrl } from './reddit/dash';

/** The link is a redirect only a browser navigation can follow. */
export class NeedsBrowserError extends Error {
  constructor(readonly url: string) {
    super(`open ${url} in the browser to reach the post`);
    this.name = 'NeedsBrowserError';
  }
}

export async function readPost(url: string, courier: Courier): Promise<RedditPost> {
  const link = classifyRedditLink(url);
  switch (link.kind) {
    case 'share':
      throw new NeedsBrowserError(link.url);
    case 'video':
      return { title: null, author: null, subreddit: null, permalink: null, video: { id: link.videoId, hasAudio: true, duration: 0, width: 0, height: 0 } };
    case 'post': {
      const jsonUrl = postJsonUrl(link.canonical);
      if (!courier.canRead(jsonUrl)) throw new CourierBlockedError(jsonUrl);
      return parsePostListing(JSON.parse(await courier.text(jsonUrl)));
    }
    case 'unknown':
      throw new Error(`not a reddit post or video link: ${link.url}`);
  }
}

export type Stage = 'manifest' | 'video' | 'audio' | 'mux' | 'done';

export interface RegiftOptions {
  readonly videoId: string;
  readonly courier: Courier;
  readonly muxer: Muxer;
  readonly maxHeight?: number;
  readonly onStage?: (stage: Stage) => void;
  readonly onProgress?: (stage: Stage, ratio: number) => void;
}

export interface RegiftOutput {
  readonly bytes: Uint8Array;
  readonly filename: string;
}

export async function regiftVideo(opts: RegiftOptions): Promise<RegiftOutput> {
  const stage = (s: Stage): void => opts.onStage?.(s);
  const progress = (s: Stage) => (loaded: number, total: number | null) =>
    opts.onProgress?.(s, total ? loaded / total : 0);

  stage('manifest');
  const tracks = parseDashManifest(await opts.courier.text(manifestUrl(opts.videoId)));
  const picked = pickTracks(tracks, opts.maxHeight === undefined ? {} : { maxHeight: opts.maxHeight });

  stage('video');
  const video = await opts.courier.bytes(trackUrl(opts.videoId, picked.video.file), progress('video'));
  const filename = `regift-${opts.videoId}.mp4`;
  if (!picked.audio) {
    stage('done');
    return { bytes: video, filename };
  }

  stage('audio');
  const audio = await opts.courier.bytes(trackUrl(opts.videoId, picked.audio.file), progress('audio'));

  stage('mux');
  const bytes = await opts.muxer.mux({ video, audio }, (r) => opts.onProgress?.('mux', r));
  stage('done');
  return { bytes, filename };
}
