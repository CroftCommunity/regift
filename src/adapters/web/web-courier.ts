// The page's courier, composed: v.redd.it by plain fetch (CORS-open), reddit.com
// post JSON by JSONP with the browser's own cookies. A JSONP refusal is reported
// as CourierBlockedError so the page can offer the assisted step — the core does
// not know or care which mechanism failed.
import { CourierBlockedError, type Courier } from '../../core/ports';
import { fetchCourier } from './fetch-courier';
import { loadJsonp, loadScriptGlobal } from './jsonp';
import { log } from '../../log';

const isRedditJson = (url: string): boolean => {
  const u = new URL(url);
  return u.hostname === 'www.reddit.com' && u.pathname.endsWith('.json');
};

const isTumblrLegacy = (url: string): boolean => {
  const u = new URL(url);
  return u.hostname.endsWith('.tumblr.com') && u.pathname === '/api/read/json';
};

export const webCourier: Courier = {
  canRead: (url) => fetchCourier.canRead(url) || isRedditJson(url),
  text: async (url) => {
    // Tumblr's legacy read answers as JavaScript with no CORS header; a script
    // tag loads it from any origin, no cookies involved (measured 2026-08-30).
    if (isTumblrLegacy(url)) return JSON.stringify(await loadScriptGlobal(url, 'tumblr_api_read'));
    if (!isRedditJson(url)) return fetchCourier.text(url);
    try {
      return JSON.stringify(await loadJsonp(url));
    } catch (err) {
      log.info('jsonp read refused, falling back to the assisted step', err);
      throw new CourierBlockedError(url);
    }
  },
  bytes: (url, onProgress) => fetchCourier.bytes(url, onProgress),
};
