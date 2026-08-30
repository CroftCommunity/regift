import { test, expect } from '@playwright/test';

// The relative-path standard: the same build served under /pr-preview/pr-1/
// (a GitHub project page's shape) renders with every asset resolving.
test('renders under a subpath with no failed requests', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto('./', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(failed, `failed requests: ${failed.join(', ')}`).toEqual([]);
});

test('relative nav stays within the subpath', async ({ page }) => {
  await page.goto('./', { waitUntil: 'networkidle' });
  await page.locator('.tab', { hasText: 'Settings' }).click();
  await expect(page).toHaveURL(/\/pr-preview\/pr-1\/settings\.html$/);
});
