// Reading a Reddit post from a page with NO user step. reddit.com sends no CORS
// headers, but its .json endpoints still honour `?jsonp=<callback>` (measured
// 2026-08-30): the response is JavaScript, which a <script> tag may load from
// any origin — and the request carries the browser's own Reddit cookies, which is
// what gets it past the gate. Cold (no cookies) the script 403s and onerror fires;
// a browser that blocks third-party cookies (Brave Shields) behaves the same, and
// the caller falls through to the assisted step. CSP: build.mjs admits
// https://www.reddit.com in script-src for exactly this.

/** The callback-carrying URL, and the global name the response will call. */
export function jsonpRequest(url: string, seq: number): { readonly src: string; readonly name: string } {
  const name = `__regift_jsonp_${seq}`;
  const u = new URL(url);
  u.searchParams.set('jsonp', name);
  return { src: u.href, name };
}

let seq = 0;

export function loadJsonp(url: string, timeoutMs = 10_000): Promise<unknown> {
  const { src, name } = jsonpRequest(url, ++seq);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const w = window as unknown as Record<string, unknown>;
    const done = (): void => {
      delete w[name];
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`jsonp ${url}: timed out`));
    }, timeoutMs);
    w[name] = (data: unknown): void => {
      done();
      resolve(data);
    };
    script.onerror = () => {
      done();
      reject(new Error(`jsonp ${url}: refused`));
    };
    script.src = src;
    document.head.append(script);
  });
}
