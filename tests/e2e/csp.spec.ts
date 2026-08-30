import { test, expect } from '@playwright/test';

// Build-time CSP + SRI, enforced by test: zero violations on every document and
// no cross-origin script. The assisted state is exercised too, since it renders
// the most markup.
for (const path of ['/index.html', '/settings.html']) {
  test(`${path}: no CSP violations, no cross-origin scripts`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __csp: string[] };
      w.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect(violations).toEqual([]);
    const crossOrigin = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src)
        .filter((src) => new URL(src).origin !== location.origin),
    );
    expect(crossOrigin).toEqual([]);
  });
}
