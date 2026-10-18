import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { setSyncingMode } from '#server/sync';
import { loadRules, resetState } from '#server/transactions/transaction-rules';

import {
  configureHousehold,
  getHouseholdOverview,
  loadHouseholdProfile,
} from './actuynab-household';
import { syntheticHouseholdSetupFixture } from './actuynab-household.fixture';
import { prepareImportReview } from './actuynab-review';

async function configuredAccounts() {
  const profile = await loadHouseholdProfile();
  if (!profile) throw new Error('Expected a configured synthetic household');
  return new Map(profile.accounts.map(account => [account.role, account]));
}

async function balance(accountId: string) {
  const row = await db.first<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account = ? AND is_parent = 0`,
    [accountId],
  );
  return row?.balance ?? 0;
}

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
  setSyncingMode('enabled');
});

afterEach(() => setSyncingMode('disabled'));

describe('ActuYNAB Milestone 7 household budget experience', () => {
  test('rejects an ambiguous household setup before changing financial records', async () => {
    const fixture = syntheticHouseholdSetupFixture();
    fixture.accounts[1].name = fixture.accounts[0].name;

    await expect(configureHousehold(fixture)).rejects.toThrow(
      'distinct compatible account name',
    );
    expect(
      await db.first<{ count: number }>(
        'SELECT COUNT(*) AS count FROM accounts WHERE tombstone = 0',
      ),
    ).toEqual({ count: 0 });
  });

  test('creates a configurable, synced household setup and template idempotently', async () => {
    const first = await configureHousehold(syntheticHouseholdSetupFixture());

    expect(first.createdAccountIds).toHaveLength(7);
    expect(first.createdCategoryGroups).toBe(9);
    expect(first.createdCategories).toBeGreaterThan(10);
    expect(first.profile.accounts).toHaveLength(7);
    expect(first.profile.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Synthetic Activo',
          onBudget: true,
          role: 'joint-checking',
        }),
        expect.objectContaining({
          name: 'Synthetic Home',
          onBudget: false,
          role: 'mortgage',
        }),
        expect.objectContaining({
          name: 'Synthetic Tesla',
          onBudget: false,
          role: 'vehicle-financing',
        }),
      ]),
    );
    expect(
      await db.all<{ name: string }>(
        `SELECT name FROM accounts
       WHERE tombstone = 0
       ORDER BY name`,
      ),
    ).toHaveLength(7);

    const second = await configureHousehold(syntheticHouseholdSetupFixture());
    expect(second).toMatchObject({
      createdAccountIds: [],
      createdCategories: 0,
      createdCategoryGroups: 0,
    });
    expect(
      await db.all<{ dataset: string }>(
        `SELECT DISTINCT dataset FROM messages_crdt
       WHERE dataset LIKE 'actuynab_household_%'
       ORDER BY dataset`,
      ),
    ).toEqual([
      { dataset: 'actuynab_household_account_roles' },
      { dataset: 'actuynab_household_profiles' },
    ]);
  });

  test('uses persisted roles after reload to protect transfers and card payments', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const checking = accounts.get('joint-checking');
    const profile = await loadHouseholdProfile();
    const creditCard = profile?.accounts.find(account =>
      account.transferDescriptionTokens?.includes(
        'PAGAMENTO CC ACTIVO CLASSIC',
      ),
    );
    if (!checking || !creditCard) throw new Error('Synthetic accounts missing');

    await db.insertTransaction({
      account: checking.id,
      amount: -1000,
      date: '2017-01-10',
      id: 'synthetic-card-payment',
      imported_payee: 'PAGAMENTO CC ACTIVO CLASSIC',
    });
    const reloaded = await loadHouseholdProfile();
    expect(
      reloaded?.accounts.find(account => account.id === creditCard.id),
    ).toEqual(expect.objectContaining({ role: 'credit-card' }));

    const review = await prepareImportReview({
      accountId: checking.id,
      sourceBank: 'activobank',
      sourceFormat: 'csv',
      transactionIds: ['synthetic-card-payment'],
    });
    expect(review.items[0].classification).toMatchObject({
      reason: 'credit-card-bill-payment',
      proposedCategoryId: null,
      transferTargetAccountId: creditCard.id,
    });
  });

  test('reports household amounts without treating transfers or financing as spending', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const checking = accounts.get('joint-checking');
    const creditCard = accounts.get('credit-card');
    const mortgage = accounts.get('mortgage');
    if (!checking || !creditCard || !mortgage) {
      throw new Error('Synthetic accounts missing');
    }
    const groceries = await db.first<{ id: string }>(
      "SELECT id FROM categories WHERE name = 'Groceries' AND tombstone = 0",
    );
    if (!groceries) throw new Error('Synthetic groceries category missing');

    await db.insertTransaction({
      account: creditCard.id,
      amount: -2400,
      category: groceries.id,
      date: '2017-01-10',
      id: 'synthetic-card-purchase',
    });
    await db.insertTransaction({
      account: creditCard.id,
      amount: 300,
      category: groceries.id,
      date: '2017-01-11',
      id: 'synthetic-card-refund',
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -5000,
      date: '2017-01-12',
      id: 'synthetic-card-payment-outflow',
    });
    await db.insertTransaction({
      account: creditCard.id,
      amount: 1000,
      date: '2017-01-12',
      id: 'synthetic-card-payment-inflow',
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -7000,
      date: '2017-01-13',
      id: 'synthetic-home-transfer',
    });
    await db.insertTransaction({
      account: mortgage.id,
      amount: 7000,
      date: '2017-01-13',
      id: 'synthetic-home-transfer-counterpart',
    });
    await db.insert('actuynab_import_batches', {
      id: 'synthetic-pending-review',
      account_id: checking.id,
      source_bank: 'other',
      source_format: 'csv',
      source_fingerprint: 'synthetic',
      created_at: '2017-01-13T00:00:00.000Z',
      review_status: 'pending',
      tombstone: 0,
    });

    const checkingBefore = await balance(checking.id);
    const cardBefore = await balance(creditCard.id);
    const mortgageBefore = await balance(mortgage.id);
    const overview = await getHouseholdOverview();

    expect(overview).toMatchObject({
      isConfigured: true,
      monthlySpending: 2100,
      pendingImportReviews: 1,
      totalCreditCardLiabilities: 1100,
      totalFinancingLiabilities: 7000,
      totalLiabilities: 8100,
    });
    expect(overview.checkingAccounts).toContainEqual(
      expect.objectContaining({ id: checking.id, balance: checkingBefore }),
    );
    expect(overview.creditCardLiabilities).toContainEqual(
      expect.objectContaining({ id: creditCard.id, balance: cardBefore }),
    );
    expect(overview.financingAccounts).toContainEqual(
      expect.objectContaining({ id: mortgage.id, balance: mortgageBefore }),
    );
    expect(await balance(checking.id)).toBe(checkingBefore);
    expect(await balance(creditCard.id)).toBe(cardBefore);
    expect(await balance(mortgage.id)).toBe(mortgageBefore);
  });
});
