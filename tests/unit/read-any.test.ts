import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readAny, NeedsBrowserError } from '../../src/core/pipeline';
import { NeedsSignInError } from '../../src/core/sources';
import type { Courier } from '../../src/core/ports';

const listing = readFileSync(new URL('../fixtures/reddit/post-video.json', import.meta.url), 'utf8');
const status = readFileSync(new URL('../fixtures/mastodon/mastodon-image-status.json', import.meta.url), 'utf8');
const courier: Courier = {
  canRead: () => true,
  text: (url) => Promise.resolve(url.includes('reddit.com') ? listing : status),
  bytes: () => Promise.reject(new Error('no bytes')),
};

// One entry point for the page: any supported link → a Post with media items.
describe('readAny', () => {
  it('a reddit video post becomes a Post with a reddit-video item', async () => {
    const post = await readAny('https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/', courier);
    expect(post.source).toBe('reddit');
    expect(post.items).toEqual([{ kind: 'reddit-video', videoId: 'blke7z3ttolh1' }]);
    expect(post.author).toBe('someredditor');
    expect(post.where).toBe('r/GuysBeingDudes');
  });

  it('a mastodon link dispatches to its reader', async () => {
    const post = await readAny('https://mastodon.social/@Mastodon/116929144390213579', courier);
    expect(post.source).toBe('mastodon');
    expect(post.items[0]?.kind).toBe('file');
  });

  it('a reddit share link still needs the browser', async () => {
    await expect(readAny('https://www.reddit.com/r/x/s/AbC', courier)).rejects.toBeInstanceOf(NeedsBrowserError);
  });

  it('a pixelfed link is refused with the reason: the instance requires sign-in to read', async () => {
    await expect(readAny('https://gram.social/p/chase523/98647664694091234', courier)).rejects.toBeInstanceOf(NeedsSignInError);
  });

  it('an unknown link is refused by name', async () => {
    await expect(readAny('https://example.com/x', courier)).rejects.toThrow(/not a supported/i);
  });
});

describe('readAny: reddit images become file items', () => {
  it('a gallery becomes numbered image files', async () => {
    const gallery = readFileSync(new URL('../fixtures/reddit/post-gallery.json', import.meta.url), 'utf8');
    const c: Courier = { ...courier, text: () => Promise.resolve(gallery) };
    const post = await readAny('https://www.reddit.com/r/pics/comments/1gal001/three_views/', c);
    expect(post.items).toEqual([
      { kind: 'file', url: 'https://i.redd.it/aaa111.jpg', mime: 'image/jpeg', filename: 'regift-reddit-1gal001-1.jpg' },
      { kind: 'file', url: 'https://i.redd.it/bbb222.png', mime: 'image/png', filename: 'regift-reddit-1gal001-2.png' },
      { kind: 'file', url: 'https://i.redd.it/ccc333.gif', mime: 'image/gif', filename: 'regift-reddit-1gal001-3.gif' },
    ]);
  });
});
