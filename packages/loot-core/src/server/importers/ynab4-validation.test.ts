import * as fs from '#platform/server/fs';
import * as db from '#server/db';
import { handlers } from '#server/main';

import { importForValidation, parseFile } from './ynab4';
import type * as YNAB4 from './ynab4-types';
import {
  buildYnab4MigrationReport,
  formatYnab4MigrationReportJson,
  formatYnab4MigrationReportMarkdown,
} from './ynab4-validation';
import {
  createYnab4MigrationArchive,
  createYnab4MigrationFixture,
} from './ynab4-validation-fixture';

declare global {
  var restoreDateNow: () => void;
  var restoreFakeDateNow: () => void;
}

const importDocumentDir = fs.join(
  __dirname,
  '../../mocks/files/actuynab-m2-import-budgets',
);

function live<T extends { isTombstone?: boolean }>(entities: T[]) {
  return entities.filter(entity => !entity.isTombstone);
}

function sourceTransactionIds(data: YNAB4.YFull) {
  return live(data.transactions).flatMap(transaction => [
    transaction.entityId,
    ...live(transaction.subTransactions ?? []).map(child => child.entityId),
  ]);
}

function sourceCategoryIds(data: YNAB4.YFull) {
  return live(data.masterCategories).flatMap(masterCategory =>
    masterCategory.type === 'OUTFLOW'
      ? live(masterCategory.subCategories ?? []).map(
          category => category.entityId,
        )
      : [],
  );
}

function monthFromInteger(month: number) {
  const value = String(month);
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

function getMappedId(entityIdMap: Map<string, string>, sourceId: string) {
  const actualId = entityIdMap.get(sourceId);
  if (!actualId) {
    throw new Error(`Missing Actual mapping for ${sourceId}`);
  }
  return actualId;
}

async function collectDestination(
  data: YNAB4.YFull,
  entityIdMap: Map<string, string>,
) {
  const sourceIdByActualId = new Map(
    [...entityIdMap].map(([sourceId, actualId]) => [actualId, sourceId]),
  );
  const accountIds = live(data.accounts).map(account => account.entityId);
  const categoryIds = sourceCategoryIds(data);
  const payeeIds = live(data.payees).map(payee => payee.entityId);
  const transactionIds = sourceTransactionIds(data);

  const accounts = await Promise.all(
    accountIds.map(async sourceId => {
      const actualId = getMappedId(entityIdMap, sourceId);
      const balance = await db.first<{ balance: number }>(
        `SELECT COALESCE(SUM(amount), 0) AS balance
         FROM v_transactions
         WHERE account = ? AND is_parent = 0`,
        [actualId],
      );
      return { sourceId, balance: balance?.balance ?? 0 };
    }),
  );

  const categories = (
    await Promise.all(
      categoryIds.map(async sourceId => {
        const actualId = getMappedId(entityIdMap, sourceId);
        const category = await db.first<{ id: string }>(
          'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
          [actualId],
        );
        return category ? { sourceId } : null;
      }),
    )
  ).filter((category): category is { sourceId: string } => category !== null);

  const payees = (
    await Promise.all(
      payeeIds.map(async sourceId => {
        const actualId = getMappedId(entityIdMap, sourceId);
        const payee = await db.first<{ id: string }>(
          'SELECT id FROM payees WHERE id = ? AND tombstone = 0',
          [actualId],
        );
        return payee ? { sourceId } : null;
      }),
    )
  ).filter((payee): payee is { sourceId: string } => payee !== null);

  const transactions = (
    await Promise.all(
      transactionIds.map(async sourceId => {
        const actualId = getMappedId(entityIdMap, sourceId);
        const transaction = await db.first<db.DbViewTransaction>(
          'SELECT * FROM v_transactions WHERE id = ?',
          [actualId],
        );
        if (!transaction) {
          return null;
        }
        return {
          sourceId,
          accountSourceId:
            sourceIdByActualId.get(transaction.account) ?? 'unmapped-account',
          amount: transaction.amount,
          isChild: transaction.is_child === 1,
          isParent: transaction.is_parent === 1,
          parentSourceId:
            transaction.parent_id == null
              ? null
              : (sourceIdByActualId.get(transaction.parent_id) ?? null),
          categorySourceId:
            transaction.category == null
              ? null
              : (sourceIdByActualId.get(transaction.category) ?? null),
          transferSourceId:
            transaction.transfer_id == null
              ? null
              : (sourceIdByActualId.get(transaction.transfer_id) ?? null),
          cleared: transaction.cleared === 1,
          reconciled: transaction.reconciled === 1,
        };
      }),
    )
  ).filter(
    (
      transaction,
    ): transaction is {
      sourceId: string;
      accountSourceId: string;
      amount: number;
      isChild: boolean;
      isParent: boolean;
      parentSourceId: string | null;
      categorySourceId: string | null;
      transferSourceId: string | null;
      cleared: boolean;
      reconciled: boolean;
    } => transaction !== null,
  );

  const budgetAllocations = (
    await db.all<db.DbZeroBudget>(
      'SELECT id, month, category, amount, carryover, goal, long_goal FROM zero_budgets',
    )
  )
    .map(allocation => {
      const categorySourceId = sourceIdByActualId.get(allocation.category);
      return categorySourceId
        ? {
            month: monthFromInteger(allocation.month),
            categorySourceId,
            amount: allocation.amount,
            carryover: allocation.carryover === 1,
          }
        : null;
    })
    .filter(
      (
        allocation,
      ): allocation is {
        month: string;
        categorySourceId: string;
        amount: number;
        carryover: boolean;
      } => allocation !== null,
    );

  return {
    accounts,
    categories,
    payees,
    transactions,
    budgetAllocations,
    scheduledTransactionCount: 0,
    payeeRuleCount: 0,
  };
}

async function importSyntheticMigration() {
  await global.emptyDatabase()();
  const source = createYnab4MigrationFixture();
  globalThis.restoreDateNow();
  let archive: Buffer;
  try {
    archive = createYnab4MigrationArchive(source);
  } finally {
    globalThis.restoreFakeDateNow();
  }
  const originalArchive = Buffer.from(archive);
  const originalSource = JSON.stringify(source);
  const parsed = parseFile(archive);

  expect(JSON.stringify(source)).toBe(originalSource);
  expect(archive).toEqual(originalArchive);

  fs._setDocumentDir(importDocumentDir);
  if (!(await fs.exists(importDocumentDir))) {
    await fs.mkdir(importDocumentDir);
  }

  await handlers['api/start-import']({ budgetName: 'ActuYNAB M2 Synthetic' });
  try {
    const entityIdMap = await importForValidation(parsed);
    const destination = await collectDestination(parsed, entityIdMap);
    return buildYnab4MigrationReport(parsed, destination, {
      sourceFingerprint: 'synthetic-m2-ynab4',
    });
  } finally {
    await handlers['api/abort-import']();
    fs._setDocumentDir(null);
    if (await fs.exists(importDocumentDir)) {
      await fs.removeDirRecursively(importDocumentDir);
    }
  }
}

describe('YNAB 4 migration validation', () => {
  test('imports a synthetic archive into an isolated database and produces reproducible JSON and Markdown reports', async () => {
    const firstReport = await importSyntheticMigration();
    const secondReport = await importSyntheticMigration();

    expect(firstReport).toEqual(secondReport);
    expect(formatYnab4MigrationReportJson(firstReport)).toBe(
      formatYnab4MigrationReportJson(secondReport),
    );
    expect(firstReport.outcome).toBe('passed');
    expect(firstReport.source.counts).toMatchObject({
      accounts: 3,
      transactions: 7,
      splitTransactions: 1,
      splitChildren: 2,
      transferRelationships: 1,
      scheduledTransactions: 1,
      payeeRules: 1,
    });
    expect(firstReport.discrepancies).toEqual([
      expect.objectContaining({
        kind: 'expected-model-difference',
        check: 'scheduled-transactions',
        expected: 1,
        actual: 0,
      }),
      expect.objectContaining({
        kind: 'expected-model-difference',
        check: 'payee-rules',
        expected: 1,
        actual: 0,
      }),
      expect.objectContaining({
        kind: 'expected-model-difference',
        check: 'account-types',
      }),
      expect.objectContaining({
        kind: 'expected-model-difference',
        check: 'reconciliation-checkpoints',
      }),
    ]);

    const json = formatYnab4MigrationReportJson(firstReport);
    expect(JSON.parse(json)).toEqual(firstReport);
    expect(formatYnab4MigrationReportMarkdown(firstReport)).toContain(
      '| expected-model-difference | scheduled-transactions |',
    );
  });

  test('reports a financial discrepancy with the expected and actual values', async () => {
    const source = createYnab4MigrationFixture();
    const report = buildYnab4MigrationReport(source, {
      accounts: [
        { sourceId: 'account-checking', balance: 1 },
        { sourceId: 'account-savings', balance: 50000 },
        { sourceId: 'account-credit', balance: -25000 },
      ],
      categories: [],
      payees: [],
      transactions: [],
      budgetAllocations: [],
      scheduledTransactionCount: 0,
      payeeRuleCount: 0,
    });

    expect(report.outcome).toBe('financial-discrepancies');
    expect(report.discrepancies).toContainEqual(
      expect.objectContaining({
        kind: 'financial',
        check: 'account-balance',
        entity: 'account:account-checking',
        expected: 71250,
        actual: 1,
      }),
    );
  });
});
