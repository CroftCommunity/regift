// How long a video is and how big it is shown, read from the mp4 container
// itself (ISO/IEC 14496-12 boxes), so cutting a clip does not depend on the
// browser being able to DECODE the video: a <video> that cannot play the codec
// never reports a duration, and the clip handles would have nothing to span.
//
// Two shapes reach regift. A plain mp4 states its length in mvhd. A fragmented
// one — Reddit's CMAF tracks, which a silent Reddit video is handed out as —
// states 0 there, and the length is the sum of the sample durations in its
// fragments (moof/traf: trun per-sample, else tfhd default, else trex default).

export interface VideoInfo {
  /** Seconds. */
  readonly duration: number;
  /** As displayed: a sideways-stored phone video reports its upright size. */
  readonly width: number;
  readonly height: number;
}

interface Box {
  readonly type: string;
  /** Payload start (after the size/type header) and end, absolute. */
  readonly start: number;
  readonly end: number;
}

function boxes(dv: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = dv.getUint32(at);
    const type = String.fromCharCode(dv.getUint8(at + 4), dv.getUint8(at + 5), dv.getUint8(at + 6), dv.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) break;
      size = Number(dv.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (dv: DataView, box: Box | undefined, type: string): Box | undefined =>
  box ? boxes(dv, box.start, box.end).find((b) => b.type === type) : undefined;

/** mvhd and mdhd share a layout: version, then timescale and duration. */
function timing(dv: DataView, box: Box): { timescale: number; duration: number } {
  return dv.getUint8(box.start) === 1
    ? { timescale: dv.getUint32(box.start + 20), duration: Number(dv.getBigUint64(box.start + 24)) }
    : { timescale: dv.getUint32(box.start + 12), duration: dv.getUint32(box.start + 16) };
}

function fragmentTicks(dv: DataView, top: readonly Box[], trackId: number, trexDefault: number): number {
  let ticks = 0;
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of boxes(dv, moof.start, moof.end).filter((b) => b.type === 'traf')) {
      const tfhd = child(dv, traf, 'tfhd');
      if (!tfhd || dv.getUint32(tfhd.start + 4) !== trackId) continue;
      const tfFlags = dv.getUint32(tfhd.start) & 0xffffff;
      let o = tfhd.start + 8 + (tfFlags & 0x1 ? 8 : 0) + (tfFlags & 0x2 ? 4 : 0);
      const fallback = tfFlags & 0x8 ? dv.getUint32(o) : trexDefault;
      for (const trun of boxes(dv, traf.start, traf.end).filter((b) => b.type === 'trun')) {
        const flags = dv.getUint32(trun.start) & 0xffffff;
        const count = dv.getUint32(trun.start + 4);
        if (!(flags & 0x100)) {
          ticks += count * fallback;
          continue;
        }
        const stride = 4 * [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
        o = trun.start + 8 + (flags & 0x1 ? 4 : 0) + (flags & 0x4 ? 4 : 0);
        for (let i = 0; i < count && o + 4 <= trun.end; i++, o += stride) ticks += dv.getUint32(o);
      }
    }
  }
  return ticks;
}

/** The first video track's length and displayed size, or null if this is not an mp4 with video. */
export function mp4Info(bytes: Uint8Array): VideoInfo | null {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const top = boxes(dv, 0, dv.byteLength);
    const moov = top.find((b) => b.type === 'moov');
    const mvhd = child(dv, moov, 'mvhd');
    if (!moov || !mvhd) return null;
    const trak = boxes(dv, moov.start, moov.end)
      .filter((b) => b.type === 'trak')
      .find((t) => {
        const hdlr = child(dv, child(dv, t, 'mdia'), 'hdlr');
        return hdlr !== undefined && String.fromCharCode(...bytes.subarray(hdlr.start + 8, hdlr.start + 12)) === 'vide';
      });
    const tkhd = child(dv, trak, 'tkhd');
    const mdhd = child(dv, child(dv, trak, 'mdia'), 'mdhd');
    if (!tkhd || !mdhd) return null;

    const v1 = dv.getUint8(tkhd.start) === 1;
    const trackId = dv.getUint32(tkhd.start + (v1 ? 20 : 12));
    const matrix = tkhd.start + (v1 ? 52 : 40);
    const dims = matrix + 36;
    let width = dv.getUint32(dims) / 0x10000;
    let height = dv.getUint32(dims + 4) / 0x10000;
    // Matrix a = 0 means a quarter turn: the stored frame is shown sideways.
    if (dv.getInt32(matrix) === 0 && dv.getInt32(matrix + 4) !== 0) [width, height] = [height, width];

    const movie = timing(dv, mvhd);
    let duration = movie.timescale ? movie.duration / movie.timescale : 0;
    if (duration === 0) {
      const mehd = child(dv, child(dv, moov, 'mvex'), 'mehd');
      if (mehd && movie.timescale) {
        duration = (dv.getUint8(mehd.start) === 1 ? Number(dv.getBigUint64(mehd.start + 4)) : dv.getUint32(mehd.start + 4)) / movie.timescale;
      }
    }
    if (duration === 0) {
      const trex = boxes(dv, child(dv, moov, 'mvex')?.start ?? 0, child(dv, moov, 'mvex')?.end ?? 0).find(
        (b) => b.type === 'trex' && dv.getUint32(b.start + 4) === trackId,
      );
      const track = timing(dv, mdhd);
      if (track.timescale) duration = fragmentTicks(dv, top, trackId, trex ? dv.getUint32(trex.start + 12) : 0) / track.timescale;
    }
    return { duration, width: Math.round(width), height: Math.round(height) };
  } catch {
    // A truncated or lying box size reads past the end: not an mp4 we can read.
    return null;
  }
}
