// The seams between the platform-free core and whatever shell runs it. A shell
// (web page today; a browser extension or a Capacitor app later) supplies one
// implementation of each; the core never touches fetch, window, or the DOM.
//
// Why ports and not direct calls: the ONE thing that differs between shells is
// who is allowed to read which origin (a page cannot read reddit.com; a native
// HTTP stack can), so that difference has to be a value the core asks about,
// not an assumption baked into it.

/** Reads bytes and text from URLs on behalf of the core. */
export interface Courier {
  /** Whether this courier can read the given URL at all (origin policy, CORS). */
  canRead(url: string): boolean;
  text(url: string): Promise<string>;
  bytes(url: string, onProgress?: (loaded: number, total: number | null) => void): Promise<Uint8Array>;
}

/** Combines a video-only track and an audio-only track into one playable file. */
export interface Muxer {
  mux(
    input: { readonly video: Uint8Array; readonly audio: Uint8Array },
    onProgress?: (ratio: number) => void,
  ): Promise<Uint8Array>;
}

/** Hands a finished file to the next app (the OS share sheet, or a download). */
export interface ShareOut {
  canShareFiles(): boolean;
  share(file: File): Promise<void>;
}

/** The courier cannot read this URL; the shell must obtain it another way. */
export class CourierBlockedError extends Error {
  constructor(readonly url: string) {
    super(`this courier cannot read ${url}`);
    this.name = 'CourierBlockedError';
  }
}
