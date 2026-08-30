// A Tumblr post through the legacy `<blog>.tumblr.com/api/read/json?id=`, which
// still answers (2026-08-30) as JavaScript — `var tumblr_api_read = {…};` — so
// the web courier loads it as a script; the core sees the JSON text either
// way. Three post shapes carry media: `photo` (photos[] or photo-url-*),
// `regular` with inline <img>/<video> in the body, and `video` (Tumblr-hosted
// mp4 in the player, or a third-party embed we refuse by name).
import type { Courier } from '../ports';
import { extensionFor, mimeFromUrl, stripHtml, type MediaItem, type Post } from '../post';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export class UnsupportedMediaError extends Error {
  constructor(what: string) {
    super(`regift does not handle ${what}`);
    this.name = 'UnsupportedMediaError';
  }
}

export const tumblrPostUrl = (blog: string, id: string): string => `https://${blog}.tumblr.com/api/read/json?id=${id}`;

/** The JSON inside `var tumblr_api_read = {…};`, or the bare JSON if already unwrapped. */
export function unwrapLegacyJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('tumblr: not the legacy JSON');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

const IMG_TAG = /<img\b[^>]*>/gi;
const VIDEO_SRC = /<source\b[^>]*\bsrc="([^"]+\.mp4)"/gi;

/** The widest candidate in an <img>'s srcset, else its src. */
function largestImageIn(tag: string): string | null {
  const srcset = /\bsrcset="([^"]+)"/.exec(tag)?.[1];
  if (srcset) {
    const best = srcset
      .split(',')
      .map((c) => c.trim().split(/\s+/))
      .map(([url, w]) => ({ url: url ?? '', w: Number.parseInt(w ?? '0', 10) }))
      .sort((a, b) => b.w - a.w)[0];
    if (best?.url) return best.url;
  }
  return /\bsrc="([^"]+)"/.exec(tag)?.[1] ?? null;
}

function largestPhoto(photo: Obj): string | null {
  for (const key of ['photo-url-1280', 'photo-url-500', 'photo-url-400', 'photo-url-250']) {
    const u = str(photo[key]);
    if (u) return u;
  }
  return null;
}

function mediaUrls(post: Obj): string[] {
  const type = str(post['type']);
  if (type === 'photo') {
    const photos = Array.isArray(post['photos']) && post['photos'].length > 0 ? (post['photos'] as unknown[]).filter(isObj) : [post];
    return photos.map(largestPhoto).filter((u): u is string => u !== null);
  }
  if (type === 'video') {
    const player = [post['video-player'], post['video-player-500'], post['video-source']].map((v) => str(v) ?? '').join('\n');
    const mp4s = [...player.matchAll(VIDEO_SRC)].map((m) => m[1] ?? '');
    if (mp4s.length > 0) return mp4s;
    const source = str(post['video-source']) ?? '';
    if (/youtube\.com|youtu\.be/.test(source)) throw new UnsupportedMediaError('YouTube embeds');
    throw new UnsupportedMediaError('this video embed');
  }
  const body = str(post['regular-body']) ?? '';
  const videos = [...body.matchAll(VIDEO_SRC)].map((m) => m[1] ?? '');
  const images = [...body.matchAll(IMG_TAG)].map((m) => largestImageIn(m[0])).filter((u): u is string => u !== null);
  return [...videos, ...images].filter((u) => /^https?:\/\//.test(u));
}

export async function readTumblr(link: { readonly blog: string; readonly id: string }, courier: Courier): Promise<Post> {
  const data = unwrapLegacyJson(await courier.text(tumblrPostUrl(link.blog, link.id)));
  const post = isObj(data) && Array.isArray(data['posts']) ? (data['posts'] as unknown[]).find(isObj) : undefined;
  if (!post) throw new Error('tumblr: no post in the response');
  const urls = mediaUrls(post);
  const many = urls.length > 1;
  const items: MediaItem[] = urls.map((url, i) => {
    const mime = mimeFromUrl(url);
    return { kind: 'file', url, mime, filename: `regift-tumblr-${link.id}${many ? `-${i + 1}` : ''}.${extensionFor(mime)}` };
  });
  const title = str(post['regular-title']) ?? str(post['photo-caption']) ?? str(post['video-caption']) ?? null;
  return {
    source: 'tumblr',
    title: title ? stripHtml(title) : null,
    author: link.blog,
    where: null,
    permalink: `https://www.tumblr.com/${link.blog}/${link.id}`,
    items,
  };
}
