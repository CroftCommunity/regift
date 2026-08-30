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
  const manifest = (await res.json()) as { share_target: { action: string; method: string; params: Record<string, string> } };
  expect(manifest.share_target.action).toBe('index.html');
  expect(manifest.share_target.method).toBe('GET');
  expect(manifest.share_target.params).toEqual({ title: 'title', text: 'text', url: 'url' });
});
