import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { setSyncingMode } from '#server/sync';
import { loadRules, resetState } from '#server/transactions/transaction-rules';

import {
  getFinancingBreakdownCandidates,
  getHouseholdFinancingOverview,
  saveFinancingBreakdown,
} from './actuynab-financing';
import { configureHousehold, loadHouseholdProfile } from './actuynab-household';
import { syntheticHouseholdSetupFixture } from './actuynab-household.fixture';

async function configuredAccounts() {
  const profile = await loadHouseholdProfile();
  if (!profile) throw new Error('Expected a configured synthetic household');
  return new Map(profile.accounts.map(account => [account.key, account]));
}

async function ledgerBalance(accountId: string) {
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

describe('ActuYNAB Milestone 10 financing management', () => {
  test('records a verified split payment without changing balances or reconciliation', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const checking = accounts.get('activo');
    const home = accounts.get('home');
    if (!checking || !home) throw new Error('Synthetic accounts missing');

    await db.insertTransaction({
      account: checking.id,
      amount: -100_000,
      date: '2017-01-10',
      id: 'synthetic-home-payment-parent',
      is_parent: true,
      reconciled: true,
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -75_000,
      date: '2017-01-10',
      id: 'synthetic-home-principal-child',
      is_child: true,
      parent_id: 'synthetic-home-payment-parent',
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -25_000,
      date: '2017-01-10',
      id: 'synthetic-home-interest-child',
      is_child: true,
      parent_id: 'synthetic-home-payment-parent',
    });
    await db.insertTransaction({
      account: home.id,
      amount: 75_000,
      date: '2017-01-10',
      id: 'synthetic-home-principal-counterpart',
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -6_000,
      date: '2017-01-11',
      id: 'synthetic-home-insurance-charge',
    });
    const checkingBefore = await ledgerBalance(checking.id);
    const homeBefore = await ledgerBalance(home.id);

    const input = {
      financingAccountId: home.id,
      paymentTransactionId: 'synthetic-home-payment-parent',
      principalTransactionId: 'synthetic-home-principal-counterpart',
      paymentDirection: 'payment' as const,
      principalAmount: 75_000,
      interestAmount: 25_000,
      insuranceAmount: 6_000,
      insuranceTransactionId: 'synthetic-home-insurance-charge',
    };
    await saveFinancingBreakdown(input);
    await saveFinancingBreakdown(input);

    const overview = await getHouseholdFinancingOverview();
    const homeOverview = overview.accounts.find(
      account => account.accountId === home.id,
    );
    expect(homeOverview).toMatchObject({
      knownInsurance: 6_000,
      knownInterest: 25_000,
      knownPrincipal: 75_000,
      needsReviewCount: 0,
      outstandingBalance: homeBefore,
    });
    expect(homeOverview?.installments).toEqual([
      expect.objectContaining({
        insuranceIsSeparate: true,
        paymentAmount: 100_000,
        status: 'verified',
      }),
    ]);
    expect(
      await db.first<{ count: number }>(
        `SELECT COUNT(*) AS count FROM actuynab_financing_installments
         WHERE tombstone = 0`,
      ),
    ).toEqual({ count: 1 });
    expect(await ledgerBalance(checking.id)).toBe(checkingBefore);
    expect(await ledgerBalance(home.id)).toBe(homeBefore);
    expect(await db.getTransaction('synthetic-home-payment-parent')).toEqual(
      expect.objectContaining({ reconciled: true }),
    );
    expect(
      await db.all<{ dataset: string }>(
        `SELECT DISTINCT dataset FROM messages_crdt
         WHERE dataset = 'actuynab_financing_installments'`,
      ),
    ).toEqual([{ dataset: 'actuynab_financing_installments' }]);
  });

  test('reports partial payments and refunds as verified history without adding them to the liability', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const checking = accounts.get('activo');
    const tesla = accounts.get('tesla');
    if (!checking || !tesla) throw new Error('Synthetic accounts missing');

    const movements = [
      ['partial-payment', checking.id, -50_000],
      ['partial-principal', tesla.id, 40_000],
      ['refund', checking.id, 10_000],
      ['refund-principal', tesla.id, -10_000],
    ] as const;
    for (const [id, account, amount] of movements) {
      await db.insertTransaction({
        account,
        amount,
        date: id.startsWith('refund') ? '2017-02-11' : '2017-02-10',
        id: `synthetic-tesla-${id}`,
      });
    }
    const checkingBefore = await ledgerBalance(checking.id);
    const teslaBefore = await ledgerBalance(tesla.id);

    await saveFinancingBreakdown({
      financingAccountId: tesla.id,
      paymentTransactionId: 'synthetic-tesla-partial-payment',
      principalTransactionId: 'synthetic-tesla-partial-principal',
      paymentDirection: 'payment',
      principalAmount: 40_000,
      interestAmount: 10_000,
      insuranceAmount: 0,
    });
    await saveFinancingBreakdown({
      financingAccountId: tesla.id,
      paymentTransactionId: 'synthetic-tesla-refund',
      principalTransactionId: 'synthetic-tesla-refund-principal',
      paymentDirection: 'refund',
      principalAmount: 10_000,
      interestAmount: 0,
      insuranceAmount: 0,
    });

    const overview = await getHouseholdFinancingOverview();
    const teslaOverview = overview.accounts.find(
      account => account.accountId === tesla.id,
    );
    expect(teslaOverview).toMatchObject({
      knownInsurance: 0,
      knownInterest: 10_000,
      knownPrincipal: 30_000,
      outstandingBalance: teslaBefore,
    });
    expect(teslaOverview?.installments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paymentDirection: 'payment' }),
        expect.objectContaining({ paymentDirection: 'refund' }),
      ]),
    );
    expect(await ledgerBalance(checking.id)).toBe(checkingBefore);
    expect(await ledgerBalance(tesla.id)).toBe(teslaBefore);
  });

  test('rejects incomplete, duplicate, or non-ledger allocations and marks changed evidence for review', async () => {
    await configureHousehold(syntheticHouseholdSetupFixture());
    const accounts = await configuredAccounts();
    const checking = accounts.get('activo');
    const home = accounts.get('home');
    if (!checking || !home) throw new Error('Synthetic accounts missing');
    await db.insertTransaction({
      account: checking.id,
      amount: -20_000,
      date: '2017-03-10',
      id: 'synthetic-march-payment',
    });
    await db.insertTransaction({
      account: checking.id,
      amount: -15_000,
      date: '2017-03-11',
      id: 'synthetic-march-second-payment',
    });
    await db.insertTransaction({
      account: home.id,
      amount: 15_000,
      date: '2017-03-10',
      id: 'synthetic-march-principal',
    });

    await expect(
      saveFinancingBreakdown({
        financingAccountId: home.id,
        paymentTransactionId: 'synthetic-march-payment',
        principalTransactionId: 'synthetic-march-principal',
        paymentDirection: 'payment',
        principalAmount: 15_000,
        interestAmount: 4_000,
        insuranceAmount: 0,
      }),
    ).rejects.toThrow('must equal the selected payment amount');

    await saveFinancingBreakdown({
      financingAccountId: home.id,
      paymentTransactionId: 'synthetic-march-second-payment',
      principalTransactionId: 'synthetic-march-principal',
      paymentDirection: 'payment',
      principalAmount: 15_000,
      interestAmount: 0,
      insuranceAmount: 0,
    });
    await expect(
      saveFinancingBreakdown({
        financingAccountId: home.id,
        paymentTransactionId: 'synthetic-march-payment',
        principalTransactionId: 'synthetic-march-principal',
        paymentDirection: 'payment',
        principalAmount: 15_000,
        interestAmount: 5_000,
        insuranceAmount: 0,
      }),
    ).rejects.toThrow('already allocated');

    await db.updateTransaction({
      id: 'synthetic-march-principal',
      amount: 14_000,
    });
    const overview = await getHouseholdFinancingOverview();
    const homeOverview = overview.accounts.find(
      account => account.accountId === home.id,
    );
    expect(homeOverview).toMatchObject({
      knownPrincipal: 0,
      needsReviewCount: 1,
    });

    const candidates = await getFinancingBreakdownCandidates();
    expect(candidates.checkingTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'synthetic-march-payment' }),
      ]),
    );
    expect(candidates.financingTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'synthetic-march-principal' }),
      ]),
    );
  });
});
