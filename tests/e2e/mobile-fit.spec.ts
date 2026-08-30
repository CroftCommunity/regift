import { test, expect } from '@playwright/test';

// Mobile-first: nothing may overflow horizontally at 320/360/390. The assisted
// state carries the longest strings (a .json URL), so it is measured too.
// Element geometry, not scrollWidth alone: a scrollWidth check cannot fail under
// overflow-x: clip (CroftC/.claude/MOBILE-FIRST.md).
async function widestElement(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('body *')).map((el) => el.getBoundingClientRect().right)),
  );
}

for (const width of [320, 360, 390]) {
  for (const path of ['/index.html', '/settings.html']) {
    test(`no horizontal overflow: ${path} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      expect(await widestElement(page)).toBeLessThanOrEqual(width);
    });
  }
  test(`no horizontal overflow: assisted state at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.route('https://www.reddit.com/**', (route) => route.fulfill({ status: 403, body: 'blocked' }));
    await page.goto('/index.html?url=' + encodeURIComponent('https://www.reddit.com/r/GuysBeingDudes/comments/1vys36f/dad_jokes/'));
    await page.getByTestId('go').click();
    await expect(page.getByTestId('assisted')).toBeVisible();
    expect(await widestElement(page)).toBeLessThanOrEqual(width);
  });
}
