// The page's own courier: plain fetch. Reads anything that sends CORS — and the
// media hosts regift uses all do (measured 2026-08-30: v.redd.it, Bluesky PDSs and
// the public AppView, Mastodon instances and their files hosts, Tumblr's CDNs).
// The host families it declines up front are reddit.com (measured 2026-08-30)
// and instagram.com (2026-09-23), which send no CORS headers, so the core routes
// around them (JSONP, then the assisted step, for Reddit; the native courier for
// Instagram — its media CDN, *.fbcdn.net / cdninstagram.com, sends `*` and is
// read here as usual).
import type { Courier } from '../../core/ports';

const NO_CORS = /(^|\.)reddit\.com$|(^|\.)instagram\.com$/;

async function readAll(res: Response, onProgress?: (loaded: number, total: number | null) => void): Promise<Uint8Array> {
  const total = Number(res.headers.get('content-length')) || null;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res;
}

export const fetchCourier: Courier = {
  canRead: (url) => !NO_CORS.test(new URL(url).hostname),
  text: async (url) => (await get(url)).text(),
  bytes: async (url, onProgress) => readAll(await get(url), onProgress),
};
