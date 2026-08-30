// One classifier for every source. Reddit keeps its own finer classification;
// fediverse hosts are arbitrary, so Mastodon and Pixelfed are recognised by
// their path shapes.
import { classifyRedditLink, type RedditLink } from './reddit/link';

export type Link =
  | { readonly source: 'reddit'; readonly link: RedditLink }
  | { readonly source: 'bluesky'; readonly actor: string; readonly rkey: string }
  | { readonly source: 'mastodon'; readonly host: string; readonly id: string }
  | { readonly source: 'tumblr'; readonly blog: string; readonly id: string }
  | { readonly source: 'pixelfed'; readonly host: string; readonly user: string; readonly id: string }
  | { readonly source: 'unknown'; readonly url: string };

const REDDIT = /(^|\.)reddit\.com$|^v\.redd\.it$|^redd\.it$/;
const BSKY_POST = /^\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/;
const TUMBLR_SHARE = /^\/([A-Za-z0-9-]+)\/(\d+)(?:\/|$)/;
const TUMBLR_BLOG = /^\/post\/(\d+)(?:\/|$)/;
const MASTODON_AT = /^\/@[^/]+\/(\d+)(?:\/|$)/;
const MASTODON_USERS = /^\/users\/[^/]+\/statuses\/(\d+)(?:\/|$)/;
const PIXELFED = /^\/p\/([^/]+)\/(\d+)(?:\/|$)/;

export function classifyLink(url: string): Link {
  const u = new URL(url);
  const host = u.hostname;
  if (REDDIT.test(host)) return { source: 'reddit', link: classifyRedditLink(url) };
  if (host === 'bsky.app') {
    const m = BSKY_POST.exec(u.pathname);
    return m?.[1] && m[2] ? { source: 'bluesky', actor: decodeURIComponent(m[1]), rkey: m[2] } : { source: 'unknown', url };
  }
  if (host === 'www.tumblr.com' || host === 'tumblr.com') {
    const m = TUMBLR_SHARE.exec(u.pathname);
    return m?.[1] && m[2] ? { source: 'tumblr', blog: m[1], id: m[2] } : { source: 'unknown', url };
  }
  if (host.endsWith('.tumblr.com')) {
    const m = TUMBLR_BLOG.exec(u.pathname);
    return m?.[1] ? { source: 'tumblr', blog: host.slice(0, -'.tumblr.com'.length), id: m[1] } : { source: 'unknown', url };
  }
  const masto = MASTODON_AT.exec(u.pathname) ?? MASTODON_USERS.exec(u.pathname);
  if (masto?.[1]) return { source: 'mastodon', host, id: masto[1] };
  const pf = PIXELFED.exec(u.pathname);
  if (pf?.[1] && pf[2]) return { source: 'pixelfed', host, user: pf[1], id: pf[2] };
  return { source: 'unknown', url };
}

/** The source can be reached only with a signed-in session the page does not have. */
export class NeedsSignInError extends Error {
  constructor(
    readonly source: string,
    readonly url: string,
  ) {
    super(`${source} requires sign-in to read ${url}`);
    this.name = 'NeedsSignInError';
  }
}
