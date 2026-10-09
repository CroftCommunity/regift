import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

// Cut a clip: a video that is already here (shared in as a file, the route that
// needs no courier) gets two handles; the span between them comes out as a GIF
// or an mp4, encoded by the REAL vendored ffmpeg.wasm in the real browser.

const VIDEO = readFileSync(new URL('../fixtures/media/video.mp4', import.meta.url)); // 2.0 s, 90×160, 15 fps
const LONG = readFileSync(new URL('../fixtures/media/long.mp4', import.meta.url)); // 60 s, 32×32, 2 fps

test.use({ serviceWorkers: 'allow' });

/** Share the fixture video in through the worker, as the OS would, and land. */
async function sharedVideo(page: Page, video: Buffer = VIDEO): Promise<void> {
  await page.goto('/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });
  const landing = await page.evaluate(async (b64) => {
    const form = new FormData();
    form.append('media', new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'clip-me.mp4', { type: 'video/mp4' }));
    return (await fetch('share-target', { method: 'POST', body: form })).url;
  }, video.toString('base64'));
  await page.goto(landing);
  await expect(page.getByTestId('trim')).toBeVisible();
  await expect(page.getByTestId('clip-gif')).toBeEnabled();
}

/** mvhd duration in seconds (version 0 or 1). */
function mp4Duration(buf: Buffer): number {
  const at = buf.indexOf('mvhd', 0, 'latin1');
  const v = buf.readUInt8(at + 4);
  return v === 1 ? Number(buf.readBigUInt64BE(at + 28)) / buf.readUInt32BE(at + 24) : buf.readUInt32BE(at + 20) / buf.readUInt32BE(at + 16);
}

/** Frames in a GIF: one Graphic Control Extension (21 F9 04) each, as ffmpeg writes them. */
const gifFrames = (buf: Buffer): number => buf.toString('latin1').split('\x21\xf9\x04').length - 1;

test('the handles start at the ends, and neither can pass the other', async ({ page }) => {
  await sharedVideo(page);
  await expect(page.getByTestId('trim-readout')).toContainText('0:00.0 → 0:02.0 · 2.0 s');
  await page.getByTestId('trim-start').fill('1.5');
  await page.getByTestId('trim-end').fill('0.5');
  // The end stopped the minimum length past the start (0.2 s).
  await expect(page.getByTestId('trim-readout')).toContainText('0:01.5 → 0:01.7 · 0.2 s');
  await expect(page.getByTestId('trim-end')).toHaveAttribute('aria-valuetext', '0:01.7');
});

test('a start and end can be typed, and the slider follows', async ({ page }) => {
  await sharedVideo(page);
  await expect(page.getByTestId('trim-start-time')).toHaveValue('0:00.0');
  await expect(page.getByTestId('trim-end-time')).toHaveValue('0:02.0');
  await page.getByTestId('trim-start-time').fill('0:00.5');
  await page.getByTestId('trim-end-time').fill('1.5');
  await page.getByTestId('trim-end-time').press('Enter');
  await expect(page.getByTestId('trim-readout')).toContainText('0:00.5 → 0:01.5 · 1.0 s');
  await expect(page.getByTestId('trim-start')).toHaveValue('0.5');
  await expect(page.getByTestId('trim-end')).toHaveValue('1.5');
  await expect(page.getByTestId('trim-end-time')).toHaveValue('0:01.5');

  // A typed start past the end carries the end along instead of stopping short.
  await page.getByTestId('trim-start-time').fill('1.8');
  await page.getByTestId('trim-start-time').press('Enter');
  await expect(page.getByTestId('trim-readout')).toContainText('0:01.8 → 0:02.0 · 0.2 s');

  // Not a time: the box says so and the clip stays put.
  await page.getByTestId('trim-start-time').fill('soon');
  await page.getByTestId('trim-start-time').press('Enter');
  await expect(page.getByTestId('trim-start-time')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('trim-time-hint')).toContainText('1:23.4');
  await expect(page.getByTestId('trim-readout')).toContainText('0:01.8 → 0:02.0');
  await page.getByTestId('trim-start-time').fill('1');
  await page.getByTestId('trim-start-time').press('Enter');
  await expect(page.getByTestId('trim-start-time')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('trim-readout')).toContainText('0:01.0 → 0:02.0');
});

test('zoom narrows the slider to the clip, so a few seconds are a visible distance', async ({ page }) => {
  await sharedVideo(page, LONG);
  await expect(page.getByTestId('trim-scale')).toContainText('0:00.0');
  await expect(page.getByTestId('trim-scale')).toContainText('1:00.0');
  await page.getByTestId('trim-start-time').fill('20');
  await page.getByTestId('trim-end-time').fill('30');
  await page.getByTestId('trim-end-time').press('Enter');
  const railShare = async () =>
    page.evaluate(() => {
      const rail = document.querySelector('.range2');
      const fill = document.querySelector('.range2-fill');
      if (!rail || !fill) throw new Error('no rail');
      return fill.getBoundingClientRect().width / rail.getBoundingClientRect().width;
    });
  expect(await railShare()).toBeLessThan(0.2); // 10 s of 60

  await page.getByTestId('trim-zoom').click();
  await expect(page.getByTestId('trim-zoom')).toHaveText('Zoom out');
  // 2 s either side: the slider now spans 0:18.0 to 0:32.0.
  await expect(page.getByTestId('trim-start')).toHaveAttribute('min', '18');
  await expect(page.getByTestId('trim-end')).toHaveAttribute('max', '32');
  await expect(page.getByTestId('trim-scale')).toContainText('0:18.0');
  await expect(page.getByTestId('trim-scale')).toContainText('0:32.0');
  expect(await railShare()).toBeGreaterThan(0.6);

  // The handles still move in real seconds, and the clip did not change by zooming.
  await expect(page.getByTestId('trim-readout')).toContainText('0:20.0 → 0:30.0');
  await page.getByTestId('trim-start').fill('21.5');
  await expect(page.getByTestId('trim-readout')).toContainText('0:21.5 → 0:30.0');

  // A typed time outside the zoom refits it, rather than pinning a handle to the edge.
  await page.getByTestId('trim-start-time').fill('5');
  await page.getByTestId('trim-start-time').press('Enter');
  // Now 0:05 to 0:30: 15% of 25 s (3.75 s) either side, out to the tenth.
  await expect(page.getByTestId('trim-start')).toHaveAttribute('min', '1.2');
  await expect(page.getByTestId('trim-end')).toHaveAttribute('max', '33.8');

  await page.getByTestId('trim-zoom').click();
  await expect(page.getByTestId('trim-zoom')).toHaveText('Zoom in');
  await expect(page.getByTestId('trim-start')).toHaveAttribute('min', '0');
  await expect(page.getByTestId('trim-end')).toHaveAttribute('max', '60');
});

test('"Now" sets a start or end to where the video is paused', async ({ page }) => {
  await sharedVideo(page);
  // The setter moves the playback position at once (no need to wait for a decoded frame).
  const seek = (t: number) =>
    page.evaluate((t) => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="result"] video');
      if (!v) throw new Error('no video');
      v.pause();
      v.currentTime = t;
    }, t);
  await seek(0.6);
  await page.getByTestId('trim-start-now').click();
  await seek(1.3);
  await page.getByTestId('trim-end-now').click();
  await expect(page.getByTestId('trim-readout')).toContainText('0:00.6 → 0:01.3 · 0.7 s');
  await expect(page.getByTestId('trim-start-time')).toHaveValue('0:00.6');
});

test('the span between the handles becomes a looping GIF', async ({ page }) => {
  test.setTimeout(120_000); // the 31 MB core loads once per browser context
  await sharedVideo(page);
  await page.getByTestId('trim-start').fill('0.5');
  await page.getByTestId('trim-end').fill('1.5');
  await expect(page.getByTestId('trim-readout')).toContainText('0:00.5 → 0:01.5 · 1.0 s\nGIF 90×160, 15 fps');

  await page.getByTestId('clip-gif').click();
  await expect(page.getByTestId('clip-save')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('clip-result').locator('img.preview')).toHaveAttribute('alt', 'clip-me-0.5s-1.5s.gif');

  const download = page.waitForEvent('download');
  await page.getByTestId('clip-save').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('clip-me-0.5s-1.5s.gif');
  const out = readFileSync(await dl.path());
  expect(out.toString('latin1', 0, 6)).toBe('GIF89a');
  expect(out.readUInt16LE(6)).toBe(90);
  expect(out.readUInt16LE(8)).toBe(160);
  // One second at 15 fps — not the two seconds of the whole video.
  expect(gifFrames(out)).toBeGreaterThanOrEqual(14);
  expect(gifFrames(out)).toBeLessThanOrEqual(16);
  expect(out.toString('latin1')).toContain('NETSCAPE2.0'); // loops
});

test('the span becomes an mp4 that starts where the handle was, not on a keyframe', async ({ page }) => {
  test.setTimeout(120_000);
  await sharedVideo(page);
  await page.getByTestId('trim-start').fill('0.7');
  await page.getByTestId('trim-end').fill('1.6');

  await page.getByTestId('clip-mp4').click();
  await expect(page.getByTestId('clip-save')).toBeVisible({ timeout: 90_000 });
  const download = page.waitForEvent('download');
  await page.getByTestId('clip-save').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('clip-me-0.7s-1.6s.mp4');
  const out = readFileSync(await dl.path());
  expect(out.toString('latin1', 4, 8)).toBe('ftyp');
  // 0.9 s asked. The fixture's only keyframe is at 0.0, so a stream copy would
  // back up to it and carry 1.6 s (24 frames, measured with -c copy). A re-encode
  // lands within a frame or two (66 ms each at 15 fps); ffmpeg.wasm 5.1 gives 1.0.
  expect(mp4Duration(out)).toBeGreaterThan(0.85);
  expect(mp4Duration(out)).toBeLessThanOrEqual(1.0);
  await expect(page.getByTestId('clip-result').locator('video.preview')).toHaveCount(1);
});

test('the clip controls fit a 320px phone and pass axe', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await sharedVideo(page);
  const widest = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('body *')).map((el) => el.getBoundingClientRect().right)));
  expect(widest).toBeLessThanOrEqual(320);
  for (const id of ['trim-start', 'trim-end', 'trim-start-time', 'trim-end-time', 'trim-start-now', 'trim-end-now', 'trim-zoom', 'clip-gif', 'clip-mp4', 'trim-play']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
  const results = await new AxeBuilder({ page }).include('[data-testid="trim"]').analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} × ${v.nodes.length}`);
  expect(blocking, blocking.join(' · ')).toEqual([]);
});
