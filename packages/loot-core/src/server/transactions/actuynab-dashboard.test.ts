import * as budgetActions from '#server/budget/actions';
import * as budget from '#server/budget/base';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as sheet from '#server/sheet';
import { setSyncingMode } from '#server/sync';
import { loadRules, resetState } from '#server/transactions/transaction-rules';

import { getHouseholdDashboard } from './actuynab-dashboard';
import { saveFinancingBreakdown } from './actuynab-financing';
import { configureHousehold, loadHouseholdProfile } from './actuynab-household';
import { syntheticHouseholdSetupFixture } from './actuynab-household.fixture';

async function configuredAccounts() {
  const profile = await loadHouseholdProfile();
  if (!profile) throw new Error('Expected a configured synthetic household');
  return new Map(profile.accounts.map(account => [account.key, account]));
}

async function balancesFor(accountIds: readonly string[]) {
  const rows = await db.all<{ account: string; balance: number }>(
    `SELECT account, COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account IN (${accountIds.map(() => '?').join(', ')})
       AND is_parent = 0
     GROUP BY account
     ORDER BY account`,
    [...accountIds],
  );
  return rows;
}

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
  setSyncingMode('enabled');
});

afterEach(() => setSyncingMode('disabled'));

describe('ActuYNAB Milestone 11 financial dashboard', () => {
  test('projects synthetic household ledger, budget, review, and financing data without financial writes', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const activo = accounts.get('activo');
    const millenium = accounts.get('millenium');
    const ccActivo = accounts.get('cc-activo-classic');
    const ccGold = accounts.get('cc-millenium-gold');
    const ccClassic = accounts.get('cc-millenium-classic');
    const home = accounts.get('home');
    const tesla = accounts.get('tesla');
    if (
      !activo ||
      !millenium ||
      !ccActivo ||
      !ccGold ||
      !ccClassic ||
      !home ||
      !tesla
    ) {
      throw new Error('Synthetic household accounts are missing');
    }
    const categoryIds = new Map(
      (
        await db.all<{ id: string; name: string }>(
          `SELECT id, name FROM categories
           WHERE tombstone = 0
             AND name IN ('Groceries', 'Dining out', 'Fuel', 'Entertainment')`,
        )
      ).map(category => [category.name, category.id]),
    );
    const groceries = categoryIds.get('Groceries');
    const dining = categoryIds.get('Dining out');
    const fuel = categoryIds.get('Fuel');
    const entertainment = categoryIds.get('Entertainment');
    if (!groceries || !dining || !fuel || !entertainment) {
      throw new Error('Synthetic household categories are missing');
    }
    const incomeGroupId = await db.insertCategoryGroup({
      id: 'synthetic-income-group',
      is_income: 1,
      name: 'Synthetic income',
    });
    const income = await db.insertCategory({
      id: 'synthetic-income',
      cat_group: incomeGroupId,
      is_income: 1,
      name: 'Synthetic salary',
    });

    const transactions = [
      ['synthetic-dec-groceries', activo.id, -30_000, '2016-12-15', groceries],
      ['synthetic-dec-dining', activo.id, -20_000, '2016-12-18', dining],
      ['synthetic-income', activo.id, 600_000, '2017-01-02', income],
      ['synthetic-groceries', activo.id, -100_000, '2017-01-04', groceries],
      [
        'synthetic-grocery-refund',
        ccActivo.id,
        10_000,
        '2017-01-05',
        groceries,
      ],
      ['synthetic-dining', ccActivo.id, -50_000, '2017-01-06', dining],
      ['synthetic-fuel', ccGold.id, -30_000, '2017-01-07', fuel],
      [
        'synthetic-entertainment',
        ccClassic.id,
        -20_000,
        '2017-01-08',
        entertainment,
      ],
      ['synthetic-checking-transfer-out', activo.id, -250_000, '2017-01-09'],
      ['synthetic-checking-transfer-in', millenium.id, 250_000, '2017-01-09'],
      ['synthetic-card-payment', activo.id, -20_000, '2017-01-10'],
      ['synthetic-card-payment-counterpart', ccActivo.id, 20_000, '2017-01-10'],
      ['synthetic-home-payment', activo.id, -100_000, '2017-01-11'],
      ['synthetic-home-principal', home.id, 75_000, '2017-01-11'],
      ['synthetic-home-insurance', activo.id, -6_000, '2017-01-11'],
      ['synthetic-tesla-payment', millenium.id, -50_000, '2017-01-12'],
      ['synthetic-tesla-principal', tesla.id, 40_000, '2017-01-12'],
    ] as const;
    for (const [id, account, amount, date, category] of transactions) {
      await db.insertTransaction({
        account,
        amount,
        category,
        date,
        id,
      });
    }
    await db.insert('actuynab_import_batches', {
      account_id: activo.id,
      created_at: '2017-01-12T00:00:00.000Z',
      id: 'synthetic-dashboard-pending-review',
      review_status: 'pending',
      source_bank: 'other',
      source_fingerprint: 'synthetic-dashboard',
      source_format: 'csv',
      tombstone: 0,
    });
    await sheet.loadSpreadsheet(db);
    await budget.createAllBudgets();
    await Promise.all([
      budgetActions.setBudget({
        amount: 120_000,
        category: groceries,
        month: '2017-01',
      }),
      budgetActions.setBudget({
        amount: 60_000,
        category: dining,
        month: '2017-01',
      }),
      budgetActions.setBudget({
        amount: 40_000,
        category: fuel,
        month: '2017-01',
      }),
      budgetActions.setBudget({
        amount: 30_000,
        category: entertainment,
        month: '2017-01',
      }),
    ]);
    await sheet.waitOnSpreadsheet();
    await saveFinancingBreakdown({
      financingAccountId: home.id,
      insuranceAmount: 6_000,
      insuranceTransactionId: 'synthetic-home-insurance',
      interestAmount: 25_000,
      paymentDirection: 'payment',
      paymentTransactionId: 'synthetic-home-payment',
      principalAmount: 75_000,
      principalTransactionId: 'synthetic-home-principal',
    });
    await saveFinancingBreakdown({
      financingAccountId: tesla.id,
      insuranceAmount: 0,
      interestAmount: 10_000,
      paymentDirection: 'payment',
      paymentTransactionId: 'synthetic-tesla-payment',
      principalAmount: 40_000,
      principalTransactionId: 'synthetic-tesla-principal',
    });
    const accountIds = [
      activo.id,
      millenium.id,
      ccActivo.id,
      ccGold.id,
      ccClassic.id,
      home.id,
      tesla.id,
    ];
    const balancesBefore = await balancesFor(accountIds);
    const allocationsBefore = await db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM actuynab_financing_installments
       WHERE tombstone = 0`,
    );

    const dashboard = await getHouseholdDashboard({ month: '2017-01' });

    expect(dashboard).toMatchObject({
      isConfigured: true,
      month: '2017-01',
      monthly: {
        actualSpending: 190_000,
        budgetedSpending: 250_000,
        hasBudgetedSpending: true,
        income: 600_000,
      },
      overview: {
        pendingImportReviews: 1,
        totalCreditCardLiabilities: 70_000,
        totalFinancingLiabilities: 115_000,
      },
    });
    expect(dashboard.spendingTrends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryId: groceries,
          months: expect.arrayContaining([
            { amount: 30_000, month: '2016-12' },
            { amount: 90_000, month: '2017-01' },
          ]),
          total: 120_000,
        }),
        expect.objectContaining({
          categoryId: dining,
          total: 70_000,
        }),
      ]),
    );
    expect(dashboard.financing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: home.id,
          knownInsurance: 6_000,
          knownInterest: 25_000,
          knownPrincipal: 75_000,
          outstandingBalance: 75_000,
        }),
        expect.objectContaining({
          accountId: tesla.id,
          knownInsurance: 0,
          knownInterest: 10_000,
          knownPrincipal: 40_000,
          outstandingBalance: 40_000,
        }),
      ]),
    );
    expect(await balancesFor(accountIds)).toEqual(balancesBefore);
    expect(
      await db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM actuynab_financing_installments
         WHERE tombstone = 0`,
      ),
    ).toEqual(allocationsBefore);
  });

  test('rejects an invalid month without reading or writing household records', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());

    await expect(
      getHouseholdDashboard({ month: 'not-a-month' }),
    ).rejects.toThrow('valid dashboard month');
    expect(
      await db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM actuynab_financing_installments
         WHERE tombstone = 0`,
      ),
    ).toEqual({ count: 0 });
  });
});
