import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The three CORS-open sources, hermetic: every remote read is routed to a
// captured fixture, and the Save button yields the bytes the route served.
const fixture = (rel: string): Buffer => readFileSync(new URL(`../fixtures/${rel}`, import.meta.url));
const text = (rel: string): string => fixture(rel).toString('utf8');
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const cors = { 'access-control-allow-origin': '*' };

async function saved(page: Page, testid = 'save'): Promise<Buffer> {
  const dl = page.waitForEvent('download');
  await page.getByTestId(testid).click();
  return readFileSync(await (await dl).path());
}

test('Bluesky: a video post becomes the original mp4 blob from the PDS, credited', async ({ page }) => {
  const reads: string[] = [];
  await page.route('https://public.api.bsky.app/**', (route) => {
    const url = route.request().url();
    reads.push(url);
    if (url.includes('resolveHandle')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: text('bluesky/bluesky-resolve.json') });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: text('bluesky/bluesky-video-thread.json') });
  });
  await page.route('https://plc.directory/**', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: text('bluesky/bluesky-plc.json') }));
  await page.route('https://calocybe.us-west.host.bsky.network/**', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ status: 200, headers: cors, contentType: 'video/mp4', body: fixture('media/video.mp4') });
  });
  await page.goto('/index.html?url=' + encodeURIComponent('https://bsky.app/profile/rainmaker1973-m.bsky.social/post/3muciddrju72p'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('credit')).toContainText('Belgian Malinois');
  await expect(page.getByTestId('save')).toBeVisible();
  expect(reads.at(-1)).toBe('https://calocybe.us-west.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3A47im5i5ptau2br4rh7lp2ryr&cid=bafkreid6gkdh3svitvzhsvnqig3ph7szc5rsytkzwwhevd56nd3j2tsm2q');
  expect((await saved(page)).equals(fixture('media/video.mp4'))).toBe(true);
  await expect(page.getByTestId('credit-line')).toHaveText('via @rainmaker1973-m.bsky.social on Bluesky — https://bsky.app/profile/rainmaker1973-m.bsky.social/post/3muciddrju72p');
});

test('Mastodon: an image status becomes the attachment, credited with the instance', async ({ page }) => {
  await page.route('https://mastodon.social/api/v1/statuses/116929144390213579', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: text('mastodon/mastodon-image-status.json') }));
  await page.route('https://files.mastodon.social/**', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'image/png', body: PNG_1x1 }));
  await page.goto('/index.html?url=' + encodeURIComponent('https://mastodon.social/@Mastodon/116929144390213579'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('save')).toBeVisible();
  await expect(page.getByTestId('preview')).toBeVisible();
  expect((await saved(page)).equals(PNG_1x1)).toBe(true);
  await expect(page.getByTestId('credit-line')).toHaveText('via @Mastodon@mastodon.social on mastodon.social — https://mastodon.social/@Mastodon/116929144390213579');
});

test('Tumblr: the legacy read arrives as a script, the inline image is fetched from the CDN', async ({ page }) => {
  const reads: string[] = [];
  await page.route('https://ariaiscursed.tumblr.com/**', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: text('tumblr/regular-inline-images.js') });
  });
  await page.route('https://64.media.tumblr.com/**', (route) => {
    reads.push(route.request().url());
    return route.fulfill({ status: 200, headers: cors, contentType: 'image/jpeg', body: PNG_1x1 });
  });
  await page.goto('/index.html?url=' + encodeURIComponent('https://www.tumblr.com/ariaiscursed/826326755263578112?source=share'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('save')).toBeVisible();
  expect(reads).toEqual([
    'https://ariaiscursed.tumblr.com/api/read/json?id=826326755263578112',
    'https://64.media.tumblr.com/cf2d4e58d80b70b336c7617161f4e593/fd3532418aeb20f2-70/s640x960/e60ed629ae6fe9fd73a89c2101d326f8bc4dcea9.jpg',
  ]);
  expect((await saved(page)).equals(PNG_1x1)).toBe(true);
  await expect(page.getByTestId('credit-line')).toHaveText('via ariaiscursed on Tumblr — https://www.tumblr.com/ariaiscursed/826326755263578112');
});

test('Tumblr: a photo post with four photos offers four saves and a Share all', async ({ page }) => {
  await page.route('https://npr.tumblr.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: `var tumblr_api_read = ${text('tumblr/photo.json')};` }));
  await page.route('https://64.media.tumblr.com/**', (route) => route.fulfill({ status: 200, headers: cors, contentType: 'image/jpeg', body: PNG_1x1 }));
  await page.goto('/index.html?url=' + encodeURIComponent('https://npr.tumblr.com/post/613776432917774336/slug'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('save-4')).toBeVisible();
  await expect(page.getByTestId('result')).toHaveCount(4);
  expect((await saved(page, 'save-3')).equals(PNG_1x1)).toBe(true);
});

test('Tumblr: a YouTube embed is refused by name', async ({ page }) => {
  await page.route('https://npr.tumblr.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: `var tumblr_api_read = ${text('tumblr/video-youtube-embed.json')};` }));
  await page.goto('/index.html?url=' + encodeURIComponent('https://npr.tumblr.com/post/190671199343'));
  await page.getByTestId('go').click();
  await expect(page.getByRole('status').filter({ hasText: /YouTube embeds/ })).toBeVisible();
});

test('Pixelfed: refused with the reason — the instance requires sign-in', async ({ page }) => {
  await page.goto('/index.html?url=' + encodeURIComponent('https://gram.social/p/chase523/98647664694091234'));
  await page.getByTestId('go').click();
  await expect(page.getByTestId('needs-sign-in')).toContainText('Pixelfed');
});
