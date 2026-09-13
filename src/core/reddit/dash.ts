// Reddit serves a video post as separate video and audio tracks behind a DASH
// manifest at v.redd.it. Measured 2026-08-30: the manifest and every CMAF_*.mp4
// track answer 200 to a cross-origin page fetch WITHOUT the signature the post
// JSON attaches (`?a=…`), and v.redd.it sends `access-control-allow-origin: *`.
// That is the whole reason a plain page can do this part itself.
//
// The parser is a strict regex over the two manifest shapes Reddit serves (no
// DOMParser, so the core stays platform-free and unit-testable in node). Current
// transcodes put `contentType` on the AdaptationSet and name tracks `CMAF_*.mp4`;
// videos from 2019 and earlier (re-measured 2026-09-13, same CDN, same unsigned
// 200 + `access-control-allow-origin: *`) have a bare AdaptationSet, `mimeType`
// on each Representation, and bare names — `DASH_720`, `DASH_2_4_M`, `audio`.

export interface DashTrack {
  readonly kind: 'video' | 'audio';
  readonly file: string;
  readonly bandwidth: number;
  readonly codecs: string;
  /** Present on video tracks. */
  readonly height: number | null;
}

export class DashParseError extends Error {
  constructor(reason: string) {
    super(`not a v.redd.it DASH manifest: ${reason}`);
    this.name = 'DashParseError';
  }
}

const ADAPTATION = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g;
const REPRESENTATION = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g;
const attr = (attrs: string, name: string): string | null =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/** 'video' | 'audio' from a contentType ("video") or a mimeType ("video/mp4"); null otherwise. */
const trackKind = (value: string | null): DashTrack['kind'] | null => {
  const head = value?.split('/')[0];
  return head === 'video' || head === 'audio' ? head : null;
};

export function parseDashManifest(xml: string): readonly DashTrack[] {
  const tracks: DashTrack[] = [];
  for (const set of xml.matchAll(ADAPTATION)) {
    const setKind = trackKind(attr(set[1] ?? '', 'contentType'));
    for (const rep of (set[2] ?? '').matchAll(REPRESENTATION)) {
      const attrs = rep[1] ?? '';
      const kind = setKind ?? trackKind(attr(attrs, 'mimeType'));
      if (!kind) continue;
      const file = /<BaseURL>([^<]+)<\/BaseURL>/.exec(rep[2] ?? '')?.[1];
      if (!file) continue;
      const height = attr(attrs, 'height');
      tracks.push({
        kind,
        file,
        bandwidth: Number(attr(attrs, 'bandwidth') ?? 0),
        codecs: attr(attrs, 'codecs') ?? '',
        height: height === null ? null : Number(height),
      });
    }
  }
  if (!tracks.some((t) => t.kind === 'video')) throw new DashParseError('no video representation');
  return tracks;
}

export interface PickedTracks {
  readonly video: DashTrack;
  readonly audio: DashTrack | null;
}

/** Best video within the height cap (smallest if none fits), best audio if any. */
export function pickTracks(tracks: readonly DashTrack[], opts: { readonly maxHeight?: number } = {}): PickedTracks {
  const byHeight = tracks.filter((t) => t.kind === 'video').sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  const fits = opts.maxHeight === undefined ? byHeight : byHeight.filter((t) => (t.height ?? 0) <= (opts.maxHeight ?? 0));
  const video = fits.at(-1) ?? byHeight[0];
  if (!video) throw new DashParseError('no video representation');
  const audio = tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.bandwidth - b.bandwidth).at(-1) ?? null;
  return { video, audio };
}

export const manifestUrl = (videoId: string): string => `https://v.redd.it/${videoId}/DASHPlaylist.mpd`;
export const trackUrl = (videoId: string, file: string): string => `https://v.redd.it/${videoId}/${file}`;
