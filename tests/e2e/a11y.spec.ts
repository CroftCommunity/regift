import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every page × both themes, zero serious/critical axe violations. Hermetic: all
// cross-origin requests are blocked so the DOM graded here is the DOM CI sees
// (croft-pwa/docs/ACCESSIBILITY.md). The assisted state is scanned as well.
const PAGES = ['/index.html', '/settings.html'];

for (const theme of ['light', 'dark'] as const) {
  for (const path of PAGES) {
    test(`a11y: ${path} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('regift-theme', t);
        } catch {
          /* private mode */
        }
      }, theme);
      await page.route('**/*', (route) => {
        const host = new URL(route.request().url()).hostname;
        if (host === 'localhost' || host === '127.0.0.1') void route.continue();
        else void route.abort();
      });
      await page.goto(path, { waitUntil: 'networkidle' });
      const results = await new AxeBuilder({ page }).analyze();
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id} (${v.impact ?? '?'}) × ${v.nodes.length}`);
      expect(blocking, blocking.join(' · ')).toEqual([]);
    });
  }
  test(`a11y: assisted state (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('regift-theme', t);
      } catch {
        /* private mode */
      }
    }, theme);
    await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/a/comments/1abc/t/'));
    await page.getByTestId('go').click();
    await expect(page.getByTestId('assisted')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact ?? '?'}) × ${v.nodes.length}`);
    expect(blocking, blocking.join(' · ')).toEqual([]);
  });
}
