// Sorting a Reddit URL into what the core can do with it. A /s/ share link and a
// redd.it short link are redirects, and a cross-origin redirect is opaque to a
// page — only a browser navigation can follow one — so they are handed back to
// the shell rather than fetched. A post URL is canonicalised so one post has one
// .json address regardless of which host or query string the share arrived with.

export type RedditLink =
  | { readonly kind: 'share'; readonly url: string }
  | { readonly kind: 'post'; readonly canonical: string }
  | { readonly kind: 'video'; readonly videoId: string }
  | { readonly kind: 'unknown'; readonly url: string };

const REDDIT_HOSTS = new Set(['www.reddit.com', 'reddit.com', 'old.reddit.com', 'new.reddit.com', 'm.reddit.com']);
const POST_PATH = /^(?:\/r\/[^/]+)?\/comments\/[^/]+(?:\/[^/]+)?/;
const SHARE_PATH = /^\/r\/[^/]+\/s\/[^/]+/;
const VIDEO_ID = /^\/([A-Za-z0-9]+)/;

export function classifyRedditLink(url: string): RedditLink {
  const u = new URL(url);
  if (u.hostname === 'v.redd.it') {
    const m = VIDEO_ID.exec(u.pathname);
    if (m?.[1]) return { kind: 'video', videoId: m[1] };
    return { kind: 'unknown', url };
  }
  if (u.hostname === 'redd.it') return { kind: 'share', url };
  if (!REDDIT_HOSTS.has(u.hostname)) return { kind: 'unknown', url };
  if (SHARE_PATH.test(u.pathname)) return { kind: 'share', url };
  const post = POST_PATH.exec(u.pathname);
  if (post) return { kind: 'post', canonical: `https://www.reddit.com${post[0].replace(/\/$/, '')}/` };
  return { kind: 'unknown', url };
}

/** The listing-only JSON for a canonical post URL: no comment tree, unescaped strings. */
export function postJsonUrl(canonical: string): string {
  return `${canonical}.json?limit=0&raw_json=1`;
}
