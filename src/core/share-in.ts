// What arrives through a Web Share Target (or an Android SEND intent, later):
// up to three strings, any of which may carry the link. Measured 2026-08-30:
// Reddit's mobile web share button sends only `url`; other apps put the link
// inside `text`, often with words around it.
import { extensionFor, mimeFromExtension } from './post';

export interface SharedInput {
  readonly url?: string | null | undefined;
  readonly text?: string | null | undefined;
  readonly title?: string | null | undefined;
}

const HTTP_URL = /https?:\/\/[^\s<>"'`]+/;

/** The one http(s) URL out of a share payload, or null if nothing shared is one. */
export function sharedUrl(input: SharedInput): string | null {
  for (const field of [input.url, input.text, input.title]) {
    if (typeof field !== 'string') continue;
    const found = HTTP_URL.exec(field);
    if (found) return found[0];
  }
  return null;
}

/**
 * Post data arriving through the share target: from the post-data tab, select all
 * and SHARE the selection to regift, and Android delivers it as `text`. Only a JSON
 * array or object counts; a link, words, or a partial selection is null.
 */
export function sharedPostJson(input: SharedInput): unknown {
  for (const field of [input.text, input.url, input.title]) {
    if (typeof field !== 'string') continue;
    const trimmed = field.trim();
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) continue;
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Files, not just strings. Measured 2026-09-16 (curl with the deploy Origin):
// i.redd.it, preview.redd.it and external-preview.redd.it send NO
// access-control-allow-origin header at all — preview.* also 403s a hotlink —
// while v.redd.it sends `access-control-allow-origin: *` and answers an OPTIONS
// preflight. Same CDN (`server: snooserv`), opposite policy, and the reason is
// Reddit's own player: it reads DASH segments over XHR/MSE, which REQUIRES
// CORS, so the video host had to be opened up; their pictures only ever render
// in <img>, which never requires CORS, so the header was never added. regift's
// video support rides on infrastructure Reddit built for itself.
//
// Consequence: no page on any origin can fetch a Reddit picture. Not a block to
// route around — a header that does not exist (<img>+canvas taints, no-cors
// gives an opaque body, JSONP is text-only). The way in is to share the PICTURE
// instead of the link: the OS hands the bytes over and no cross-origin read
// happens at all.
/** The part of a DOM `File` this core cares about; a real File satisfies it. */
export interface SharedFile {
  readonly name: string;
  readonly type: string;
}

export interface SharedMediaItem<T> {
  readonly file: T;
  readonly mime: string;
  readonly filename: string;
}

const isMedia = (mime: string): boolean => mime.startsWith('image/') || mime.startsWith('video/');

/** The declared type without its parameters (`image/jpeg; charset=binary`). */
const declaredType = (type: string): string => (type.split(';')[0] ?? '').trim().toLowerCase();

/**
 * The media out of a file share, in the order it arrived.
 *
 * Android is inconsistent about the mime it attaches — the Reddit app sends
 * `image/jpeg`, some galleries send `application/octet-stream` or an empty
 * string — so a non-media type falls back to what the filename extension says.
 * Anything still unrecognised is DROPPED, never guessed: handing the next app a
 * file whose type we invented is worse than not handing it one.
 */
export function sharedMedia<T extends SharedFile>(files: readonly T[]): SharedMediaItem<T>[] {
  const out: SharedMediaItem<T>[] = [];
  let unnamed = 0;
  for (const file of files) {
    const declared = declaredType(typeof file.type === 'string' ? file.type : '');
    const name = typeof file.name === 'string' ? file.name.trim() : '';
    const ext = name.includes('.') ? (name.split('.').pop() ?? '') : '';
    const mime = isMedia(declared) ? declared : (mimeFromExtension(ext) ?? '');
    if (!isMedia(mime)) continue;
    unnamed += name === '' ? 1 : 0;
    out.push({ file, mime, filename: name === '' ? `regift-${unnamed}.${extensionFor(mime)}` : name });
  }
  return out;
}
