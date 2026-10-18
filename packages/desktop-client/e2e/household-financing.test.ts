import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { ConfigurationPage } from './page-models/configuration-page';

test.describe('Household financing management', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    const configurationPage = new ConfigurationPage(page);
    await configurationPage.createTestFile();
  });

  test.afterEach(async () => {
    await page?.close();
  });

  test('persists the empty-ledger financing workspace after household setup', async () => {
    await page.getByRole('link', { name: 'Household', exact: true }).click();
    await expect(
      page.getByText('Set up your shared household budget'),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Save household setup', exact: true })
      .click();

    await expect(page.getByText('Financing management')).toBeVisible();
    await expect(
      page.getByText('Record a verified financing allocation'),
    ).toBeVisible();
    await expect(
      page.getByText('No verified payment allocations yet.'),
    ).toHaveCount(2);

    await page.reload();
    await expect(page.getByText('Financing management')).toBeVisible();
    await expect(
      page.getByText('Record a verified financing allocation'),
    ).toBeVisible();
  });
});
