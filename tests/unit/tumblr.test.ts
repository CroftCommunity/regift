import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readTumblr, UnsupportedMediaError } from '../../src/core/readers/tumblr';
import type { Courier } from '../../src/core/ports';

const fx = (name: string): string => readFileSync(new URL(`../fixtures/tumblr/${name}`, import.meta.url), 'utf8');
const courier = (body: string, log: string[] = []): Courier => ({
  canRead: () => true,
  text: (url) => {
    log.push(url);
    return Promise.resolve(body);
  },
  bytes: () => Promise.reject(new Error('no bytes')),
});

// The legacy `<blog>.tumblr.com/api/read/json?id=` still answers, as JavaScript
// (`var tumblr_api_read = {…}`), which the web courier loads as a script; the
// core receives the JSON text either way. Media CDNs are CORS-open (measured).
describe('readTumblr', () => {
  it('asks the blog domain for the post, whichever link shape arrived', async () => {
    const log: string[] = [];
    await readTumblr({ blog: 'ariaiscursed', id: '826326755263578112' }, courier(fx('regular-inline-images.js'), log));
    expect(log).toEqual(['https://ariaiscursed.tumblr.com/api/read/json?id=826326755263578112']);
  });

  it('a regular post with inline images: every image, in order, with credit', async () => {
    const post = await readTumblr({ blog: 'ariaiscursed', id: '826326755263578112' }, courier(fx('regular-inline-images.js')));
    expect(post.source).toBe('tumblr');
    expect(post.author).toBe('ariaiscursed');
    expect(post.permalink).toBe('https://www.tumblr.com/ariaiscursed/826326755263578112');
    // One inline <img> whose srcset lists seven sizes: the largest wins, not the src.
    expect(post.items).toEqual([
      {
        kind: 'file',
        url: 'https://64.media.tumblr.com/cf2d4e58d80b70b336c7617161f4e593/fd3532418aeb20f2-70/s640x960/e60ed629ae6fe9fd73a89c2101d326f8bc4dcea9.jpg',
        mime: 'image/jpeg',
        filename: 'regift-tumblr-826326755263578112.jpg',
      },
    ]);
  });

  it('a photo post: the largest size of every photo', async () => {
    const post = await readTumblr({ blog: 'npr', id: '613776432917774336' }, courier(fx('photo.json')));
    expect(post.items.length).toBe(4);
    expect(post.items[0]).toMatchObject({ kind: 'file', url: expect.stringContaining('64.media.tumblr.com') as unknown, mime: 'image/jpeg' });
  });

  it('a regular post with an inline Tumblr-hosted video: the mp4', async () => {
    const post = await readTumblr({ blog: 'staff', id: '802565427665502208' }, courier(fx('regular-inline-video.json')));
    expect(post.items).toContainEqual({
      kind: 'file',
      url: 'https://va.media.tumblr.com/tumblr_t729kgZ4VU1zyvz82.mp4',
      mime: 'video/mp4',
      filename: 'regift-tumblr-802565427665502208.mp4',
    });
  });

  it('a video post that embeds YouTube is refused by name', async () => {
    await expect(readTumblr({ blog: 'npr', id: '190671199343' }, courier(fx('video-youtube-embed.json')))).rejects.toBeInstanceOf(UnsupportedMediaError);
  });

  it('fails loud on something that is not the legacy JSON', async () => {
    await expect(readTumblr({ blog: 'x', id: '1' }, courier('<!doctype html>'))).rejects.toThrow(/tumblr/i);
  });
});
