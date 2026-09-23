import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readInstagram, instagramEmbedUrl, isInstagramEmbedUrl } from '../../src/core/readers/instagram';
import { UnsupportedMediaError } from '../../src/core/readers/tumblr';
import { CourierBlockedError, type Courier } from '../../src/core/ports';

const embed = readFileSync(new URL('../fixtures/instagram/reel-embed-captioned.html', import.meta.url), 'utf8');
const courier = (body: string, log: string[] = [], canRead = true): Courier => ({
  canRead: () => canRead,
  text: (url) => {
    log.push(url);
    return Promise.resolve(body);
  },
  bytes: () => Promise.reject(new Error('no bytes')),
});
const link = { shortcode: 'DdFoiaxEw6H' };

// The post is read from its embed page, /p/<code>/embed/captioned/, which renders
// signed-out and carries the post as JSON inside `"contextJSON":"…"` (measured
// 2026-09-23). www.instagram.com sends no CORS header, so only a courier that can
// read it (a native one) gets this far; the media CDN sends `*`, so the mp4 the
// page names is a plain file item.
describe('readInstagram', () => {
  it('asks for the embed page of the shortcode, whichever link shape arrived', async () => {
    const log: string[] = [];
    await readInstagram(link, courier(embed, log));
    expect(log).toEqual(['https://www.instagram.com/p/DdFoiaxEw6H/embed/captioned/']);
    expect(instagramEmbedUrl('DdFoiaxEw6H')).toBe('https://www.instagram.com/p/DdFoiaxEw6H/embed/captioned/');
    expect(isInstagramEmbedUrl(instagramEmbedUrl('DdFoiaxEw6H'))).toBe(true);
    expect(isInstagramEmbedUrl('https://www.reddit.com/r/a/comments/1abc/t/.json')).toBe(false);
  });

  it('a reel becomes its progressive mp4 from the CDN, credited to the poster', async () => {
    const post = await readInstagram(link, courier(embed));
    expect(post.source).toBe('instagram');
    expect(post.author).toBe('lifeunfolds.ai');
    expect(post.where).toBeNull();
    expect(post.permalink).toBe('https://www.instagram.com/reel/DdFoiaxEw6H/');
    expect(post.title).toBe("I can't get over one corn kernel becoming this ear; would you grow one? #Corn #Timelapse");
    expect(post.items).toHaveLength(1);
    expect(post.items[0]).toMatchObject({ kind: 'file', mime: 'video/mp4', filename: 'regift-instagram-DdFoiaxEw6H.mp4' });
    const url = post.items[0]?.kind === 'file' ? post.items[0].url : '';
    // The JSON-in-a-string escapes are undone: a real https URL on the media CDN.
    expect(url).toMatch(/^https:\/\/instagram\.fmkc1-1\.fna\.fbcdn\.net\/o1\/v\/t2\/f2\/m86\/[A-Za-z0-9_-]+\.mp4\?_nc_cat=101&/);
    expect(url).not.toContain('\\');
  });

  it('a courier that cannot read instagram.com is told so before any read, with the embed URL', async () => {
    const log: string[] = [];
    const err = await readInstagram(link, courier(embed, log, false)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CourierBlockedError);
    expect((err as CourierBlockedError).url).toBe('https://www.instagram.com/p/DdFoiaxEw6H/embed/captioned/');
    expect(log).toEqual([]);
  });

  it('a post that is not a single video is refused by name (pictures and carousels are not read yet)', async () => {
    // The refusal keys on the GraphQL typename; the rest of the real bytes stay.
    const picture = embed.replaceAll('GraphVideo', 'GraphImage');
    await expect(readInstagram(link, courier(picture))).rejects.toBeInstanceOf(UnsupportedMediaError);
    await expect(readInstagram(link, courier(picture))).rejects.toThrow(/Instagram/);
  });

  it('fails loud on a page with no post data in it (the bare shell a non-browser client gets)', async () => {
    await expect(readInstagram(link, courier('<!doctype html><html><head><title>Instagram</title></head><body></body></html>'))).rejects.toThrow(/instagram/i);
  });
});
