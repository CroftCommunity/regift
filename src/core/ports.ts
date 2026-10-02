// The seams between the platform-free core and whatever shell runs it. A shell
// (web page today; a browser extension or a Capacitor app later) supplies one
// implementation of each; the core never touches fetch, window, or the DOM.
//
// Why ports and not direct calls: the ONE thing that differs between shells is
// who is allowed to read which origin (a page cannot read reddit.com; a native
// HTTP stack can), so that difference has to be a value the core asks about,
// not an assumption baked into it.

import type { Clip, GifPlan } from './clip';

/** Reads bytes and text from URLs on behalf of the core. */
export interface Courier {
  /** Whether this courier can read the given URL at all (origin policy, CORS). */
  canRead(url: string): boolean;
  text(url: string): Promise<string>;
  bytes(url: string, onProgress?: (loaded: number, total: number | null) => void): Promise<Uint8Array>;
}

/** Container-level tags a muxer writes into an mp4 (no re-encode). */
export interface VideoTags {
  readonly title: string;
  readonly artist: string;
  readonly comment: string;
}

/** Combines a video-only track and an audio-only track into one playable file. */
export interface Muxer {
  mux(
    input: { readonly video: Uint8Array; readonly audio: Uint8Array; readonly tags?: VideoTags },
    onProgress?: (ratio: number) => void,
  ): Promise<Uint8Array>;
  /** Rewrite the container with tags — a stream copy, not a transcode. */
  tag(video: Uint8Array, tags: VideoTags): Promise<Uint8Array>;
}

/**
 * Cuts a span out of a video. A RE-ENCODE, unlike the Muxer: a stream copy can
 * only cut on a keyframe (every 2 s on a real Reddit reel), so the clip would
 * not start where the handle was put.
 */
export interface Clipper {
  /** The span as H.264/AAC mp4, the container tags (the credit) carried over. */
  mp4(video: Uint8Array, clip: Clip, onProgress?: (ratio: number) => void): Promise<Uint8Array>;
  /** The span as a looping GIF, no sound, at the plan's frame rate and size. */
  gif(video: Uint8Array, clip: Clip, plan: GifPlan, onProgress?: (ratio: number) => void): Promise<Uint8Array>;
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
