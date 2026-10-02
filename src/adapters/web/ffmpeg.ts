// ffmpeg.wasm (single-thread core) behind the Muxer and Clipper ports, ONE
// instance for both. The Muxer is stream-copy only — a container rewrite, not a
// transcode. The Clipper re-encodes, because a copy can only cut on a keyframe.
// The core (~31 MB) is served same-origin from vendor/ffmpeg/ (copied by
// build.mjs), is NOT precached, and is fetched lazily on first use; the service
// worker's cache-first rule keeps it after that. No SharedArrayBuffer, so no
// COOP/COEP.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { Clipper, Muxer, VideoTags } from '../../core/ports';
import { clipLength, type Clip } from '../../core/clip';
import { log } from '../../log';

interface Input {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function ffmpegTools(vendorBase: URL): { readonly muxer: Muxer; readonly clipper: Clipper } {
  let loading: Promise<FFmpeg> | null = null;

  const load = (): Promise<FFmpeg> => {
    loading ??= (async () => {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => log.debug('ffmpeg', message));
      await ffmpeg.load({
        coreURL: new URL('ffmpeg-core.js', vendorBase).href,
        wasmURL: new URL('ffmpeg-core.wasm', vendorBase).href,
        classWorkerURL: new URL('worker.js', vendorBase).href,
      });
      return ffmpeg;
    })();
    return loading;
  };

  const tagArgs = (tags?: VideoTags): string[] =>
    tags ? ['-metadata', `title=${tags.title}`, '-metadata', `artist=${tags.artist}`, '-metadata', `comment=${tags.comment}`] : [];

  /** `args` is the whole command after the inputs, ending in `out`. */
  const run = async (inputs: readonly Input[], args: readonly string[], out: string, onProgress?: (e: { progress: number; time: number }) => void): Promise<Uint8Array> => {
    const ffmpeg = await load();
    const report = (e: { progress: number; time: number }): void => onProgress?.(e);
    ffmpeg.on('progress', report);
    try {
      for (const i of inputs) await ffmpeg.writeFile(i.name, i.bytes);
      const code = await ffmpeg.exec([...args]);
      if (code !== 0) throw new Error(`ffmpeg failed with exit code ${code}`);
      const bytes = await ffmpeg.readFile(out);
      if (typeof bytes === 'string') throw new Error('ffmpeg returned text for a binary file');
      return bytes;
    } finally {
      ffmpeg.off('progress', report);
      for (const f of [...inputs.map((i) => i.name), out]) await ffmpeg.deleteFile(f).catch(() => undefined);
    }
  };

  const copy = (inputs: readonly Input[], args: string[], onProgress?: (ratio: number) => void): Promise<Uint8Array> =>
    run(inputs, [...inputs.flatMap((i) => ['-i', i.name]), ...args, '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], 'out.mp4', (e) => onProgress?.(e.progress));

  // With -ss/-t the core's own ratio is measured against the WHOLE input, so the
  // clip's ratio comes from the output clock instead (`time`, microseconds).
  const clipProgress = (clip: Clip, onProgress?: (ratio: number) => void) => (e: { time: number }) =>
    onProgress?.(Math.min(1, Math.max(0, e.time / 1e6 / clipLength(clip))));

  // -ss before -i seeks; with a re-encode the cut is still frame-accurate.
  const span = (clip: Clip): string[] => ['-ss', clip.start.toFixed(3), '-t', clipLength(clip).toFixed(3), '-i', 'in.mp4'];

  return {
    muxer: {
      mux: ({ video, audio, tags }, onProgress) => copy([{ name: 'v.mp4', bytes: video }, { name: 'a.mp4', bytes: audio }], tagArgs(tags), onProgress),
      tag: (video, tags) => copy([{ name: 'in.mp4', bytes: video }], tagArgs(tags)),
    },
    clipper: {
      // veryfast: TODO.md §6 measured 110-122 fps at 360p, 29 fps at 720p on a phone.
      mp4: (video, clip, onProgress) =>
        run(
          [{ name: 'in.mp4', bytes: video }],
          [
            ...span(clip),
            '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            '-movflags', '+faststart', 'out.mp4',
          ],
          'out.mp4',
          clipProgress(clip, onProgress),
        ),
      // One graph, two passes over the same frames: palettegen builds a 256-colour
      // palette from the clip, paletteuse maps the frames onto it. diff_mode only
      // re-dithers what moved, which keeps the file smaller.
      gif: (video, clip, plan, onProgress) =>
        run(
          [{ name: 'in.mp4', bytes: video }],
          [
            ...span(clip),
            '-an',
            '-vf',
            `fps=${plan.fps},scale=${plan.width}:${plan.height}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
            '-loop', '0', 'out.gif',
          ],
          'out.gif',
          clipProgress(clip, onProgress),
        ),
    },
  };
}
