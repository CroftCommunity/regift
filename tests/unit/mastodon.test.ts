import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readMastodon } from '../../src/core/readers/mastodon';
import type { Courier } from '../../src/core/ports';

const fx = (name: string): string => readFileSync(new URL(`../fixtures/mastodon/${name}`, import.meta.url), 'utf8');
const courier = (body: string, log: string[] = []): Courier => ({
  canRead: () => true,
  text: (url) => {
    log.push(url);
    return Promise.resolve(body);
  },
  bytes: () => Promise.reject(new Error('no bytes')),
});

// /api/v1/statuses/:id is public and CORS-open on Mastodon (measured on
// mastodon.social 2026-08-30), and so are the media files it names.
describe('readMastodon', () => {
  it('an image status: the attachment URL, author, plain-text title', async () => {
    const log: string[] = [];
    const post = await readMastodon({ host: 'mastodon.social', id: '116929144390213579' }, courier(fx('mastodon-image-status.json'), log));
    expect(log).toEqual(['https://mastodon.social/api/v1/statuses/116929144390213579']);
    expect(post.source).toBe('mastodon');
    expect(post.author).toBe('Mastodon@mastodon.social');
    expect(post.permalink).toBe('https://mastodon.social/@Mastodon/116929144390213579');
    expect(post.title).not.toMatch(/<[a-z]/i);
    expect(post.items).toEqual([
      {
        kind: 'file',
        url: 'https://files.mastodon.social/media_attachments/files/116/929/144/353/146/667/original/4541caf1a6f64af8.png',
        mime: 'image/png',
        filename: 'regift-mastodon-116929144390213579.png',
      },
    ]);
  });

  it('a gifv/video status yields an mp4 item', async () => {
    const post = await readMastodon({ host: 'mastodon.social', id: '116839714185151652' }, courier(fx('mastodon-video-status.json')));
    expect(post.items).toEqual([
      {
        kind: 'file',
        url: 'https://files.mastodon.social/media_attachments/files/116/839/714/054/675/941/original/3ae728d2fb7bb7f8.mp4',
        mime: 'video/mp4',
        filename: 'regift-mastodon-116839714185151652.mp4',
      },
    ]);
  });

  it('a status with no media has no items (the page says so)', async () => {
    const post = await readMastodon({ host: 'h.example', id: '1' }, courier(JSON.stringify({ id: '1', url: 'https://h.example/@a/1', account: { acct: 'a' }, content: '<p>hi</p>', media_attachments: [] })));
    expect(post.items).toEqual([]);
  });
});
