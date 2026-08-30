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

/**
 * Load a script that assigns a global (Tumblr's legacy `var tumblr_api_read = {…}`)
 * and hand the value back. Same mechanism as JSONP, minus the callback.
 */
export function loadScriptGlobal(url: string, name: string, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // A `var` at top level is a non-configurable global: `delete` throws in strict
    // mode, so the slot is cleared by assignment.
    const w = window as unknown as Record<string, unknown>;
    w[name] = undefined;
    const done = (): void => {
      script.remove();
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`script ${url}: timed out`));
    }, timeoutMs);
    script.onload = () => {
      const value = w[name];
      w[name] = undefined;
      done();
      if (value === undefined) reject(new Error(`script ${url}: did not define ${name}`));
      else resolve(value);
    };
    script.onerror = () => {
      done();
      reject(new Error(`script ${url}: refused`));
    };
    script.src = url;
    document.head.append(script);
  });
}
