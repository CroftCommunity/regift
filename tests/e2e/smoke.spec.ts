import { test, expect } from '@playwright/test';

test('home renders the shell, wordmark, and build stamp', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'Share a post in, get the video out', level: 1 })).toBeVisible();
  await expect(page.locator('a.wordmark', { hasText: 'regift' })).toBeVisible();
  await expect(page.locator('[data-version-stamp]').first()).toBeVisible();
});

test('tabs navigate to settings (real link, real document)', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/settings\.html$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('theme toggle flips the document theme', async ({ page }) => {
  await page.goto('/index.html');
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByRole('button', { name: 'Toggle colour theme' }).click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  expect(['light', 'dark']).toContain(after);
});

test('the manifest declares a share target that lands on the home page', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    share_target: { action: string; method: string; enctype: string; params: Record<string, string> };
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  expect(manifest.share_target.action).toBe('index.html');
  expect(manifest.share_target.method).toBe('GET');
  expect(manifest.share_target.enctype).toBe('application/x-www-form-urlencoded');
  expect(manifest.share_target.params).toEqual({ title: 'title', text: 'text', url: 'url' });
});

// Chrome on Android mints a WebAPK — the only install that registers a share
// target — only when the manifest carries raster icons it can use. Measured
// 2026-08-30: with the SVG-only set, CDP Page.getManifestIcons reported "no
// primary icon" and the installed app did not appear in the share sheet.
test('the manifest carries 192 and 512 PNG icons that actually serve', async ({ request }) => {
  const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };
  const png = manifest.icons.filter((i) => i.type === 'image/png');
  expect(png.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512', '512x512']);
  expect(png.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of png) {
    const res = await request.get('/' + icon.src);
    expect(res.ok(), icon.src).toBe(true);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});
