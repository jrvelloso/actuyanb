import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

test.describe('Deployment readiness', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('initializes the production browser runtime with isolated static assets', async () => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('button', { name: 'Try the demo', exact: true }),
    ).toBeVisible();

    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => typeof globalThis.SharedArrayBuffer)).toBe(
      'function',
    );
    expect(await page.evaluate(() => typeof window.$send)).toBe('function');

    const [wasm, database, clientRoute] = await Promise.all([
      page.request.get('/sql-wasm.wasm'),
      page.request.get('/data/default-db.sqlite'),
      page.request.get('/actuynab-deployment-readiness'),
    ]);

    expect(wasm.status()).toBe(200);
    expect(wasm.headers()['content-type']).toContain('application/wasm');
    expect(database.status()).toBe(200);
    expect(clientRoute.status()).toBe(200);
    expect(clientRoute.headers()['content-type']).toContain('text/html');

    const headers = response?.headers() ?? {};
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['x-content-type-options']).toBe('nosniff');

    await page
      .getByRole('button', { name: 'Try the demo', exact: true })
      .click();
    await expect(page.getByTestId('budget-table')).toBeVisible();
  });
});
