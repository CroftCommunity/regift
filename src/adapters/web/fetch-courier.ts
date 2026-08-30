// The page's own courier: plain fetch. It can read exactly one thing a page is
// allowed to read cross-origin — v.redd.it, which sends `access-control-allow-
// origin: *` (measured 2026-08-30). reddit.com sends no CORS headers, so the
// courier says so up front and the core routes around it (the assisted step).
import type { Courier } from '../../core/ports';

const READABLE_HOSTS = new Set(['v.redd.it']);

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
  canRead: (url) => READABLE_HOSTS.has(new URL(url).hostname),
  text: async (url) => (await get(url)).text(),
  bytes: async (url, onProgress) => readAll(await get(url), onProgress),
};
