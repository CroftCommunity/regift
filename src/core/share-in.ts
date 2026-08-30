// What arrives through a Web Share Target (or an Android SEND intent, later):
// up to three strings, any of which may carry the link. Measured 2026-08-30:
// Reddit's mobile web share button sends only `url`; other apps put the link
// inside `text`, often with words around it.

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
