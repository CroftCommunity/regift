// Handing the file to the next app. On Android Chrome, navigator.share with a
// file opens the system share sheet — Photos, Bluesky, whatever is installed —
// which is the whole product. Where files cannot be shared (desktop, most
// browsers), a download is the honest fallback, and the page offers both.
import type { ShareOut } from '../../core/ports';

export const webShareOut: ShareOut = {
  canShareFiles: () => {
    try {
      const probe = new File([new Uint8Array(1)], 'probe.mp4', { type: 'video/mp4' });
      return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  },
  share: (file) => navigator.share({ files: [file], title: file.name }),
};

/** Save via a download link. The object URL is released after the click lands. */
export function saveFile(file: File): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
