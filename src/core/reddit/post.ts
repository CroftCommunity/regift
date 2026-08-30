// Reading a post out of Reddit's listing JSON — the attribution and, for a video
// post, the v.redd.it id and whether it carries sound. Shape as observed
// 2026-08-30 with `raw_json=1` (no HTML entities). A crosspost carries its
// media on the parent, so the parent is the post for our purposes: the media
// AND the credit belong to the original.

export interface RedditVideo {
  readonly id: string;
  readonly hasAudio: boolean;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
}

export interface RedditImage {
  readonly url: string;
  readonly mime: string;
}

export interface RedditPost {
  readonly title: string | null;
  readonly author: string | null;
  readonly subreddit: string | null;
  readonly permalink: string | null;
  readonly video: RedditVideo | null;
  /** A single image post's picture, or a gallery's pictures in display order. */
  readonly images: readonly RedditImage[];
}

export class PostParseError extends Error {
  constructor(reason: string) {
    super(`not a reddit post listing: ${reason}`);
    this.name = 'PostParseError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const VIDEO_URL_ID = /^https?:\/\/v\.redd\.it\/([A-Za-z0-9]+)/;

function redditVideo(data: Obj): RedditVideo | null {
  for (const container of [data['secure_media'], data['media']]) {
    if (!isObj(container)) continue;
    const rv = container['reddit_video'];
    if (!isObj(rv)) continue;
    const source = str(rv['dash_url']) ?? str(rv['fallback_url']);
    const id = source ? VIDEO_URL_ID.exec(source)?.[1] : undefined;
    if (!id) continue;
    return {
      id,
      hasAudio: rv['has_audio'] === true,
      duration: num(rv['duration']),
      width: num(rv['width']),
      height: num(rv['height']),
    };
  }
  return null;
}

const IMAGE_HOST = /^https?:\/\/i\.redd\.it\/[^?]+\.(jpe?g|png|gif|webp)$/i;
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const EXT_BY_MIME: Record<string, string> = { 'image/jpg': 'jpg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Images: `url` for a single-image post; gallery_data + media_metadata for a gallery. */
function redditImages(data: Obj): RedditImage[] {
  const gallery = data['gallery_data'];
  const meta = data['media_metadata'];
  if (isObj(gallery) && Array.isArray(gallery['items']) && isObj(meta)) {
    return (gallery['items'] as unknown[]).flatMap((item): RedditImage[] => {
      const id = isObj(item) ? str(item['media_id']) : null;
      const m = id ? meta[id] : undefined;
      if (!id || !isObj(m) || m['status'] !== 'valid') return [];
      const declared = str(m['m']) ?? '';
      const ext = EXT_BY_MIME[declared];
      if (!ext) return [];
      // The original file lives at i.redd.it/<id>.<ext>; `s.u` is a signed preview.
      return [{ url: `https://i.redd.it/${id}.${ext}`, mime: MIME_BY_EXT[ext] ?? declared }];
    });
  }
  const url = str(data['url']);
  const m = url ? IMAGE_HOST.exec(url) : null;
  if (url && m?.[1]) return [{ url, mime: MIME_BY_EXT[m[1].toLowerCase()] ?? 'image/jpeg' }];
  return [];
}

function firstPostData(json: unknown): Obj {
  const listing: unknown = Array.isArray(json) ? (json as unknown[])[0] : json;
  if (!isObj(listing) || listing['kind'] !== 'Listing') throw new PostParseError('no Listing');
  const data = listing['data'];
  if (!isObj(data) || !Array.isArray(data['children'])) throw new PostParseError('no children');
  const first: unknown = (data['children'] as unknown[])[0];
  if (!isObj(first) || !isObj(first['data'])) throw new PostParseError('empty listing');
  return first['data'];
}

export function parsePostListing(json: unknown): RedditPost {
  const own = firstPostData(json);
  const parents = own['crosspost_parent_list'];
  const parent: unknown = Array.isArray(parents) ? (parents as unknown[])[0] : undefined;
  const source = isObj(parent) && redditVideo(parent) ? parent : own;
  const permalink = str(source['permalink']);
  return {
    title: str(source['title']),
    author: str(source['author']),
    subreddit: str(source['subreddit']),
    permalink: permalink ? `https://www.reddit.com${permalink}` : null,
    video: redditVideo(source),
    images: redditVideo(source) ? [] : redditImages(source),
  };
}
