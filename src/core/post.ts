// The one shape every source reduces to: who made it, where it lives, and the
// media the page can turn into files. A `file` item is a single CORS-readable
// URL (Bluesky blob, Mastodon attachment, Tumblr CDN); a `reddit-video` item
// still needs the DASH read and the mux.

export type Source = 'reddit' | 'bluesky' | 'mastodon' | 'tumblr' | 'pixelfed';

export type MediaItem =
  | { readonly kind: 'file'; readonly url: string; readonly mime: string; readonly filename: string }
  | { readonly kind: 'reddit-video'; readonly videoId: string };

export interface Post {
  readonly source: Source;
  readonly title: string | null;
  readonly author: string | null;
  /** Where it was posted, as people say it: `r/aww`, `mastodon.social`, a blog name. */
  readonly where: string | null;
  readonly permalink: string | null;
  readonly items: readonly MediaItem[];
}

/** Text with tags removed and entities decoded, for titles taken from HTML. */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function extensionFor(mime: string): string {
  return EXT[mime] ?? mime.split('/')[1] ?? 'bin';
}

export function mimeFromUrl(url: string): string {
  const ext = new URL(url).pathname.toLowerCase().split('.').pop() ?? '';
  const found = Object.entries(EXT).find(([, e]) => e === ext || (ext === 'jpeg' && e === 'jpg'));
  return found?.[0] ?? 'application/octet-stream';
}
