// An Instagram post through its embed page, `/p/<code>/embed/captioned/` — the
// address that renders a post signed-out in a real browser (measured 2026-09-23;
// the post page and `/embed/` do too, `captioned` is the one that also prints the
// caption). The page carries the post as JSON inside a JSON string in a bootstrap
// <script>: `"contextJSON":"{\"gql_data\":{\"shortcode_media\":{…}}}"`. The core
// reads that one literal and nothing else on the page.
//
// www.instagram.com sends no access-control-allow-origin header on any of these
// addresses (and answers a non-browser TLS client with a bare shell that holds no
// data at all), so no page on any origin can read the embed itself; only a courier
// that IS a browser — the native WebView courier, TODO.md §1 — gets past `canRead`.
// The media CDN is the opposite: `*`, an OPTIONS preflight answered, so once the
// mp4's signed URL is known a plain fetch reads it. A reel is one progressive mp4
// with its audio in it (`xpv_progressive` in the URL's tag): a `file` item, no mux.
import { CourierBlockedError, type Courier } from '../ports';
import type { MediaItem, Post } from '../post';
import { UnsupportedMediaError } from './tumblr';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const instagramEmbedUrl = (shortcode: string): string => `https://www.instagram.com/p/${shortcode}/embed/captioned/`;

/** Whether a URL the courier refused is one of ours — the page picks its words by it. */
export const isInstagramEmbedUrl = (url: string): boolean => /^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/embed\/captioned\/$/.test(url);

const CONTEXT_KEY = '"contextJSON":';

/** The end index (exclusive) of the JSON string literal that starts at `start`. */
function endOfStringLiteral(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '"') return i + 1;
  }
  return -1;
}

/** The post object the embed page carries, or null when the page holds none. */
export function parseEmbedContext(html: string): unknown {
  const at = html.indexOf(CONTEXT_KEY);
  if (at === -1) return null;
  const start = at + CONTEXT_KEY.length;
  if (html[start] !== '"') return null;
  const end = endOfStringLiteral(html, start);
  if (end === -1) return null;
  const inner = JSON.parse(html.slice(start, end)) as unknown;
  return typeof inner === 'string' ? (JSON.parse(inner) as unknown) : null;
}

function caption(media: Obj): string | null {
  const edges = isObj(media['edge_media_to_caption']) ? media['edge_media_to_caption']['edges'] : null;
  const first = Array.isArray(edges) ? edges.find(isObj) : undefined;
  const node = first && isObj(first['node']) ? first['node'] : null;
  return node ? str(node['text']) : null;
}

export async function readInstagram(link: { readonly shortcode: string }, courier: Courier): Promise<Post> {
  const url = instagramEmbedUrl(link.shortcode);
  if (!courier.canRead(url)) throw new CourierBlockedError(url);
  const context = parseEmbedContext(await courier.text(url));
  const media = isObj(context) && isObj(context['gql_data']) && isObj(context['gql_data']['shortcode_media']) ? context['gql_data']['shortcode_media'] : null;
  if (!media) throw new Error('instagram: no post data in the embed page');
  const typename = str(media['__typename']);
  const videoUrl = str(media['video_url']);
  if (typename !== 'GraphVideo' || !videoUrl) throw new UnsupportedMediaError(`Instagram pictures or carousels yet — only a single video (this post is ${typename ?? 'of unknown type'})`);
  const owner = isObj(media['owner']) ? media['owner'] : {};
  const items: MediaItem[] = [{ kind: 'file', url: videoUrl, mime: 'video/mp4', filename: `regift-instagram-${link.shortcode}.mp4` }];
  return {
    source: 'instagram',
    title: caption(media),
    author: str(owner['username']),
    where: null,
    permalink: `https://www.instagram.com/${str(media['product_type']) === 'clips' ? 'reel' : 'p'}/${link.shortcode}/`,
    items,
  };
}
