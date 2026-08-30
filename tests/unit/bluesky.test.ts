import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBluesky } from '../../src/core/readers/bluesky';
import type { Courier } from '../../src/core/ports';

const fx = (name: string): string => readFileSync(new URL(`../fixtures/bluesky/${name}`, import.meta.url), 'utf8');

// Everything comes from public, CORS-open endpoints (measured 2026-08-30): the
// AppView for the post, plc.directory for the PDS, and the PDS getBlob for the
// ORIGINAL bytes — cdn.bsky.app sends no CORS, so images come from the PDS too.
function courier(log: string[]): Courier {
  return {
    canRead: () => true,
    text: (url) => {
      log.push(url);
      if (url.includes('resolveHandle')) return Promise.resolve(fx('bluesky-resolve.json'));
      if (url.startsWith('https://plc.directory/')) return Promise.resolve(fx('bluesky-plc.json'));
      if (url.includes('getPostThread') && url.includes('3muciddrju72p')) return Promise.resolve(fx('bluesky-video-thread.json'));
      if (url.includes('getPostThread') && url.includes('3muctian6of2s')) return Promise.resolve(fx('bluesky-images-thread.json'));
      return Promise.reject(new Error('unexpected ' + url));
    },
    bytes: () => Promise.reject(new Error('no bytes in this test')),
  };
}

describe('readBluesky', () => {
  it('a video post: the original mp4 blob from the PDS, with credit', async () => {
    const log: string[] = [];
    const post = await readBluesky({ actor: 'rainmaker1973-m.bsky.social', rkey: '3muciddrju72p' }, courier(log));
    expect(post.source).toBe('bluesky');
    expect(post.author).toBe('rainmaker1973-m.bsky.social');
    expect(post.permalink).toBe('https://bsky.app/profile/rainmaker1973-m.bsky.social/post/3muciddrju72p');
    expect(post.title).toMatch(/^Belgian Malinois/);
    expect(post.items).toEqual([
      {
        kind: 'file',
        url: 'https://calocybe.us-west.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3A47im5i5ptau2br4rh7lp2ryr&cid=bafkreid6gkdh3svitvzhsvnqig3ph7szc5rsytkzwwhevd56nd3j2tsm2q',
        mime: 'video/mp4',
        filename: 'regift-bluesky-3muciddrju72p.mp4',
      },
    ]);
    expect(log[0]).toContain('resolveHandle?handle=rainmaker1973-m.bsky.social');
  });

  it('a DID actor skips handle resolution', async () => {
    const log: string[] = [];
    await readBluesky({ actor: 'did:plc:47im5i5ptau2br4rh7lp2ryr', rkey: '3muciddrju72p' }, courier(log));
    expect(log.some((u) => u.includes('resolveHandle'))).toBe(false);
  });

  it('an images post: every image blob from the PDS, numbered', async () => {
    const post = await readBluesky({ actor: 'did:plc:47im5i5ptau2br4rh7lp2ryr', rkey: '3muctian6of2s' }, courier([]));
    expect(post.items.length).toBeGreaterThan(0);
    const many = post.items.length > 1;
    for (const [i, item] of post.items.entries()) {
      expect(item.kind).toBe('file');
      if (item.kind !== 'file') continue;
      expect(item.url).toMatch(/^https:\/\/calocybe\.us-west\.host\.bsky\.network\/xrpc\/com\.atproto\.sync\.getBlob\?did=did%3Aplc%3A47im5i5ptau2br4rh7lp2ryr&cid=bafkrei/);
      expect(item.mime).toMatch(/^image\//);
      expect(item.filename).toBe(`regift-bluesky-3muctian6of2s${many ? `-${i + 1}` : ''}.jpg`);
    }
  });
});
