import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { setSyncingMode } from '#server/sync';
import { loadRules, resetState } from '#server/transactions/transaction-rules';

import {
  confirmImportReview,
  loadImportReview,
  prepareImportReview,
} from './actuynab-review';

const accountId = 'activo';
const categoryId = 'cat-groceries';
const payeeId = 'payee-continente';

beforeEach(async () => {
  await global.emptyDatabase()();
  resetState();
  await loadMappings();
  await loadRules();
  await db.insertAccount({ id: accountId, name: 'Activo' });
  await db.insertAccount({ id: 'cc-activo', name: 'CC-Activo-Classic' });
  await db.insertCategoryGroup({ id: 'group-household', name: 'Household' });
  await db.insertCategory({
    id: categoryId,
    name: 'Groceries',
    cat_group: 'group-household',
  });
  await db.insertPayee({ id: payeeId, name: 'Continente' });
  await Promise.all(
    ['2026-01-03', '2026-02-03', '2026-03-03'].map((date, index) =>
      db.insertTransaction({
        account: accountId,
        amount: -1000 - index,
        category: categoryId,
        date,
        id: `history-${index}`,
        payee: payeeId,
      }),
    ),
  );
  setSyncingMode('enabled');
});

afterEach(() => setSyncingMode('disabled'));

async function addImportedTransaction(id: string, overrides = {}) {
  await db.insertTransaction({
    account: accountId,
    amount: -1234,
    cleared: true,
    date: '2026-04-10',
    id,
    imported_id: `actuynab:activobank:${id}`,
    imported_payee: 'COMPRA CARTAO CONTINENTE MONTIJO 123456',
    payee: payeeId,
    ...overrides,
  });
}

async function balance(ids: string[]) {
  const placeholders = ids.map(() => '?').join(', ');
  const row = await db.first<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE id IN (${placeholders}) AND is_parent = 0`,
    ids,
  );
  return row?.balance ?? 0;
}

describe('ActuYNAB Milestone 5 synced import review', () => {
  test('persists an approved classification and durable, raw-file-free audit through a reload', async () => {
    await addImportedTransaction('imported-continente');
    const before = await db.first<{
      amount: number;
      date: number;
      reconciled: number;
    }>('SELECT amount, date, reconciled FROM transactions WHERE id = ?', [
      'imported-continente',
    ]);
    const prepared = await prepareImportReview({
      accountId,
      auditCounts: { imported: 1, parsed: 1 },
      sourceBank: 'activobank',
      sourceFormat: 'csv',
      transactionIds: ['imported-continente'],
    });

    expect(prepared.items[0].classification).toMatchObject({
      proposedCategoryId: categoryId,
      reason: 'reliable-history',
      requiresManualReview: false,
    });
    const confirmed = await confirmImportReview({
      batchId: prepared.audit.batchId,
      decisions: [{ action: 'approve', transactionId: 'imported-continente' }],
    });

    expect(confirmed).toMatchObject({
      applied: ['imported-continente'],
      errors: [],
    });
    expect(
      await db.first(
        'SELECT category, amount, date, reconciled FROM transactions WHERE id = ?',
        ['imported-continente'],
      ),
    ).toEqual({
      category: categoryId,
      ...before,
    });

    const reloaded = await loadImportReview({
      batchId: prepared.audit.batchId,
    });
    expect(reloaded?.audit).toMatchObject({
      accountId,
      confirmedCount: 1,
      reviewStatus: 'confirmed',
      sourceBank: 'activobank',
    });
    expect(reloaded?.items[0].classification.reason).toBe(
      'manual-classification-preserved',
    );
    const persistedAudit = await db.first<{ source_fingerprint: string }>(
      'SELECT source_fingerprint FROM actuynab_import_batches WHERE id = ?',
      [prepared.audit.batchId],
    );
    const persistedDecision = await db.first<{
      normalized_payee: string;
      category_id: string;
    }>('SELECT normalized_payee, category_id FROM actuynab_review_decisions');
    expect(persistedAudit?.source_fingerprint).toHaveLength(64);
    expect(persistedDecision).toEqual({
      normalized_payee: 'CONTINENTE',
      category_id: categoryId,
    });
    expect(
      await db.all<{ dataset: string }>(
        `SELECT DISTINCT dataset FROM messages_crdt
         WHERE dataset LIKE 'actuynab_%' ORDER BY dataset`,
      ),
    ).toEqual([
      { dataset: 'actuynab_import_batches' },
      { dataset: 'actuynab_import_review_items' },
      { dataset: 'actuynab_review_decisions' },
    ]);
  });

  test('is idempotent when the same imported transaction is reviewed again', async () => {
    await addImportedTransaction('repeat-import');
    const first = await prepareImportReview({
      accountId,
      sourceBank: 'activobank',
      sourceFormat: 'csv',
      transactionIds: ['repeat-import'],
    });
    await confirmImportReview({
      batchId: first.audit.batchId,
      decisions: [{ action: 'approve', transactionId: 'repeat-import' }],
    });
    const countBefore = await db.first<{ count: number }>(
      'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
    );
    const second = await prepareImportReview({
      accountId,
      sourceBank: 'activobank',
      sourceFormat: 'csv',
      transactionIds: ['repeat-import'],
    });

    expect(second.audit.batchId).toBe(first.audit.batchId);
    expect(
      await db.first<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
      ),
    ).toEqual(countBefore);

    const duplicateOnly = await prepareImportReview({
      accountId,
      auditCounts: { duplicate: 1, imported: 0, parsed: 1 },
      sourceBank: 'activobank',
      sourceFormat: 'csv',
      sourceTransactions: [
        {
          amount: -1234,
          date: '2026-04-10',
          importedId: 'actuynab:activobank:repeat-import',
        },
      ],
      transactionIds: [],
    });
    expect(duplicateOnly).toMatchObject({
      audit: { duplicate: 1, imported: 0, parsed: 1 },
      items: [],
    });
    expect(
      await db.first<{ count: number }>(
        'SELECT COUNT(*) AS count FROM transactions WHERE tombstone = 0',
      ),
    ).toEqual(countBefore);
  });

  test('holds transfers, credit-card bill payments, reconciled rows, and splits out of automated edits', async () => {
    await addImportedTransaction('credit-card-payment', {
      imported_payee: 'PAGAMENTO CC ACTIVO CLASSIC',
      payee: null,
    });
    await addImportedTransaction('reconciled-row', { reconciled: true });
    await addImportedTransaction('split-parent', { is_parent: true });
    const ids = ['credit-card-payment', 'reconciled-row', 'split-parent'];
    const beforeBalance = await balance(ids);
    const prepared = await prepareImportReview({
      accountId,
      sourceBank: 'other',
      sourceFormat: 'ofx',
      transactionIds: ids,
    });

    expect(prepared.items.map(item => item.isProtected)).toEqual([
      false,
      true,
      true,
    ]);
    expect(prepared.items[0].classification.reason).toBe(
      'credit-card-bill-payment',
    );
    const confirmed = await confirmImportReview({
      batchId: prepared.audit.batchId,
      decisions: ids.map(transactionId => ({
        action: 'approve',
        transactionId,
      })),
    });

    expect(confirmed.applied).toEqual([]);
    expect(confirmed.errors).toHaveLength(3);
    expect(await balance(ids)).toBe(beforeBalance);
    expect(
      await db.all(
        `SELECT category FROM transactions
         WHERE id IN ('credit-card-payment', 'reconciled-row', 'split-parent')`,
      ),
    ).toEqual([{ category: null }, { category: null }, { category: null }]);
  });

  test('stores a correction without inventing a payee and rejects unknown correction targets', async () => {
    await addImportedTransaction('manual-correction', {
      imported_payee: 'Unknown synthetic shop',
      payee: null,
    });
    const prepared = await prepareImportReview({
      accountId,
      sourceBank: 'revolut',
      sourceFormat: 'csv',
      transactionIds: ['manual-correction'],
    });
    const outsideBatch = await confirmImportReview({
      batchId: prepared.audit.batchId,
      decisions: [{ action: 'approve', transactionId: 'history-0' }],
    });
    expect(outsideBatch.errors).toEqual([
      { code: 'missing-transaction', transactionId: 'history-0' },
    ]);
    const rejectedTarget = await confirmImportReview({
      batchId: prepared.audit.batchId,
      decisions: [
        {
          action: 'correct',
          categoryId: 'missing-category',
          payeeId,
          transactionId: 'manual-correction',
        },
      ],
    });
    expect(rejectedTarget.errors).toEqual([
      { code: 'unknown-category', transactionId: 'manual-correction' },
    ]);

    const corrected = await confirmImportReview({
      batchId: prepared.audit.batchId,
      decisions: [
        {
          action: 'correct',
          categoryId,
          payeeId,
          transactionId: 'manual-correction',
        },
      ],
    });
    expect(corrected.errors).toEqual([]);
    expect(
      await db.first(
        'SELECT category, payee FROM v_transactions WHERE id = ?',
        ['manual-correction'],
      ),
    ).toEqual({ category: categoryId, payee: payeeId });
    expect(
      await db.first<{ count: number }>(
        'SELECT COUNT(*) AS count FROM payees WHERE tombstone = 0',
      ),
    ).toEqual({ count: 1 });
  });
});
