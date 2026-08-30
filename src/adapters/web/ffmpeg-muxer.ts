// ffmpeg.wasm (single-thread core) behind the Muxer port. Stream-copy only —
// no re-encode — so the work is a container rewrite, not a transcode. The core
// (~31 MB) is served same-origin from vendor/ffmpeg/ (copied by build.mjs), is
// NOT precached, and is fetched lazily on first use; the service worker's
// cache-first rule keeps it after that. No SharedArrayBuffer, so no COOP/COEP.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { Muxer } from '../../core/ports';
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

  return {
    mux: async ({ video, audio }, onProgress) => {
      const ffmpeg = await load();
      const report = ({ progress }: { progress: number }): void => onProgress?.(progress);
      ffmpeg.on('progress', report);
      try {
        await ffmpeg.writeFile('v.mp4', video);
        await ffmpeg.writeFile('a.mp4', audio);
        const code = await ffmpeg.exec(['-i', 'v.mp4', '-i', 'a.mp4', '-c', 'copy', '-movflags', '+faststart', 'out.mp4']);
        if (code !== 0) throw new Error(`ffmpeg mux failed with exit code ${code}`);
        const out = await ffmpeg.readFile('out.mp4');
        if (typeof out === 'string') throw new Error('ffmpeg returned text for a binary file');
        return out;
      } finally {
        ffmpeg.off('progress', report);
        for (const f of ['v.mp4', 'a.mp4', 'out.mp4']) await ffmpeg.deleteFile(f).catch(() => undefined);
      }
    },
  };
}
