// ffmpeg.wasm (single-thread core) behind the Muxer port. Stream-copy only —
// no re-encode — so the work is a container rewrite, not a transcode. The core
// (~31 MB) is served same-origin from vendor/ffmpeg/ (copied by build.mjs), is
// NOT precached, and is fetched lazily on first use; the service worker's
// cache-first rule keeps it after that. No SharedArrayBuffer, so no COOP/COEP.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { Muxer, VideoTags } from '../../core/ports';
import { log } from '../../log';

export function ffmpegMuxer(vendorBase: URL): Muxer {
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

  const run = async (inputs: { name: string; bytes: Uint8Array }[], args: string[], onProgress?: (ratio: number) => void): Promise<Uint8Array> => {
    const ffmpeg = await load();
    const report = ({ progress }: { progress: number }): void => onProgress?.(progress);
    ffmpeg.on('progress', report);
    try {
      for (const i of inputs) await ffmpeg.writeFile(i.name, i.bytes);
      const code = await ffmpeg.exec([...inputs.flatMap((i) => ['-i', i.name]), ...args, '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
      if (code !== 0) throw new Error(`ffmpeg failed with exit code ${code}`);
      const out = await ffmpeg.readFile('out.mp4');
      if (typeof out === 'string') throw new Error('ffmpeg returned text for a binary file');
      return out;
    } finally {
      ffmpeg.off('progress', report);
      for (const f of [...inputs.map((i) => i.name), 'out.mp4']) await ffmpeg.deleteFile(f).catch(() => undefined);
    }
  };

  return {
    mux: ({ video, audio, tags }, onProgress) => run([{ name: 'v.mp4', bytes: video }, { name: 'a.mp4', bytes: audio }], tagArgs(tags), onProgress),
    tag: (video, tags) => run([{ name: 'in.mp4', bytes: video }], tagArgs(tags)),
  };
}
