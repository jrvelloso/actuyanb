import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import {
  insertRule,
  loadRules,
  resetState,
} from '#server/transactions/transaction-rules';

import { classifyHouseholdTransaction } from './actuynab-classification';
import type { HouseholdClassificationInput } from './actuynab-classification';
import { syntheticHouseholdClassificationFixture } from './actuynab-classification.fixture';

const fixture = syntheticHouseholdClassificationFixture;

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
  await Promise.all(
    fixture.accounts.map(account =>
      db.insertAccount({
        id: account.id,
        name: account.name,
      }),
    ),
  );
});

function imported(
  imported_payee: string,
  options: Partial<HouseholdClassificationInput> = {},
): HouseholdClassificationInput {
  return {
    account: 'activo-joint',
    amount: -1234,
    cleared: true,
    date: '2026-04-10',
    imported_payee,
    payee_name: imported_payee,
    reconciled: true,
    ...options,
  };
}

async function transactionCount() {
  const row = await db.first<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
  );
  return row?.count ?? 0;
}

async function accountBalance(account: string) {
  const row = await db.first<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account = ? AND is_parent = 0`,
    [account],
  );
  return row?.balance ?? 0;
}

describe('ActuYNAB Milestone 4 household classification', () => {
  test('runs an explicit Actual rule before all ActuYNAB suggestions', async () => {
    await insertRule({
      stage: null,
      conditionsOp: 'and',
      conditions: [
        { op: 'contains', field: 'imported_payee', value: 'EXPLICIT MARKET' },
      ],
      actions: [{ op: 'set', field: 'category', value: 'cat-rule' }],
    });

    const classification = await classifyHouseholdTransaction(
      imported('EXPLICIT MARKET 001'),
      fixture,
    );

    expect(classification).toMatchObject({
      confidence: 'high',
      proposedCategoryId: 'cat-rule',
      reason: 'explicit-actual-rule',
      requiresManualReview: false,
    });
  });

  test('uses confirmed mappings, reliable history, recurring patterns, and narrow merchant normalization in order', async () => {
    await expect(
      classifyHouseholdTransaction(
        imported('COMPRA CARTAO CONTINENTE MONTIJO 123456'),
        fixture,
      ),
    ).resolves.toMatchObject({
      confidence: 'high',
      normalizedPayee: 'CONTINENTE',
      proposedCategoryId: 'cat-groceries',
      proposedPayee: { id: 'payee-continente', name: 'Continente' },
      reason: 'confirmed-payee-category',
    });

    await expect(
      classifyHouseholdTransaction(imported('Farmacia Ficticia'), fixture),
    ).resolves.toMatchObject({
      proposedCategoryId: 'cat-health',
      reason: 'reliable-history',
    });

    await expect(
      classifyHouseholdTransaction(imported('Fibra Casa'), fixture),
    ).resolves.toMatchObject({
      confidence: 'medium',
      proposedCategoryId: 'cat-utilities',
      reason: 'recurring-pattern',
    });

    await expect(
      classifyHouseholdTransaction(
        imported('COMPRA CARTAO PINGO DOCE ALMADA'),
        fixture,
      ),
    ).resolves.toMatchObject({
      confidence: 'medium',
      proposedCategoryId: 'cat-groceries',
      reason: 'deterministic-merchant-heuristic',
    });
  });

  test('preserves manual classifications and holds conflicting or unknown evidence for review', async () => {
    const manual = imported('COMPRA CARTAO CONTINENTE MONTIJO', {
      category: 'cat-manual-correction',
    });
    const conflictingContext = {
      ...fixture,
      historicalTransactions: [
        {
          amount: -1000,
          categoryId: 'cat-food',
          date: '2026-01-01',
          payeeName: 'Ambiguous Shop',
        },
        {
          amount: -1000,
          categoryId: 'cat-household',
          date: '2026-02-01',
          payeeName: 'Ambiguous Shop',
        },
      ],
    };

    await expect(
      classifyHouseholdTransaction(manual, fixture),
    ).resolves.toMatchObject({
      proposedCategoryId: 'cat-manual-correction',
      reason: 'manual-classification-preserved',
      requiresManualReview: false,
    });
    await expect(
      classifyHouseholdTransaction(
        imported('Ambiguous Shop'),
        conflictingContext,
      ),
    ).resolves.toMatchObject({
      confidence: 'review',
      reason: 'conflicting-history',
      requiresManualReview: true,
    });
    await expect(
      classifyHouseholdTransaction(imported('Unknown Merchant'), fixture),
    ).resolves.toMatchObject({
      confidence: 'review',
      reason: 'manual-review',
      requiresManualReview: true,
    });
  });

  test('recognizes transfers and financing safely without turning them into new expenses', async () => {
    await expect(
      classifyHouseholdTransaction(
        imported('TRANSFERENCIA PARA MILLENIUM', { statementType: 'transfer' }),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: null,
      reason: 'internal-transfer',
      transferTargetAccountId: 'millenium-joint',
    });
    await expect(
      classifyHouseholdTransaction(
        imported('PAGAMENTO CC ACTIVO CLASSIC'),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: null,
      reason: 'credit-card-bill-payment',
      transferTargetAccountId: 'cc-activo-classic',
    });
    await expect(
      classifyHouseholdTransaction(imported('PRESTACAO CASA HOME'), fixture),
    ).resolves.toMatchObject({
      proposedCategoryId: null,
      reason: 'off-budget-financing-transfer',
      transferTargetAccountId: 'home-mortgage',
    });
    await expect(
      classifyHouseholdTransaction(
        imported('PAGAMENTO TESLA FINANCIAMENTO', {
          subtransactions: [
            { amount: -17500, category: 'cat-vehicle-principal' },
            { amount: -2500, category: 'cat-vehicle-interest' },
          ],
        }),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: null,
      reason: 'provided-loan-split-preserved',
      transferTargetAccountId: 'tesla-financing',
    });
  });

  test('handles refunds, provided splits, and explicitly identified household contributions', async () => {
    await expect(
      classifyHouseholdTransaction(
        imported('COMPRA CARTAO CONTINENTE MONTIJO 123456', {
          amount: 1234,
          statementType: 'refund',
        }),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: 'cat-groceries',
      reason: 'confirmed-payee-category',
    });
    await expect(
      classifyHouseholdTransaction(
        imported('Household market split', {
          subtransactions: [
            { amount: -1000, category: 'cat-groceries' },
            { amount: -234, category: 'cat-household' },
          ],
        }),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: null,
      reason: 'provided-split-preserved',
    });
    await expect(
      classifyHouseholdTransaction(
        imported('Personal-account household contribution', {
          amount: 125000,
          externalContribution: true,
        }),
        fixture,
      ),
    ).resolves.toMatchObject({
      proposedCategoryId: 'cat-household-contributions',
      reason: 'external-personal-contribution',
    });
  });

  test('is repeatable, preserves imported input, and does not create payees or financial rows', async () => {
    await db.insertTransaction({
      account: 'activo-joint',
      amount: 50000,
      cleared: true,
      date: '2026-04-01',
      id: 'm4-existing-financial-row',
      reconciled: true,
    });
    const transaction = imported('COMPRA CARTAO CONTINENTE MONTIJO 123456');
    const before = JSON.stringify(transaction);
    const financialRowBefore = await db.first<{
      amount: number;
      cleared: number;
      date: string;
      reconciled: number;
    }>(
      'SELECT amount, cleared, date, reconciled FROM transactions WHERE id = ?',
      ['m4-existing-financial-row'],
    );
    const balanceBefore = await accountBalance('activo-joint');
    const payeesBefore = await db.getPayees();
    const transactionsBefore = await transactionCount();

    const first = await classifyHouseholdTransaction(transaction, fixture);
    const second = await classifyHouseholdTransaction(transaction, fixture);

    expect(second).toEqual(first);
    expect(JSON.stringify(transaction)).toBe(before);
    expect(await db.getPayees()).toEqual(payeesBefore);
    expect(await transactionCount()).toBe(transactionsBefore);
    expect(await accountBalance('activo-joint')).toBe(balanceBefore);
    expect(
      await db.first(
        'SELECT amount, cleared, date, reconciled FROM transactions WHERE id = ?',
        ['m4-existing-financial-row'],
      ),
    ).toEqual(financialRowBefore);
    expect(first.proposedPayee).toEqual({
      id: 'payee-continente',
      name: 'Continente',
    });
  });
});
