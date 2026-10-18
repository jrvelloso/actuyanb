import { createApp } from '#server/app';
import { aqlQuery } from '#server/aql';
import * as db from '#server/db';
import { mutator } from '#server/mutators';
import { undoable } from '#server/undo';
import { q, Query } from '#shared/query';
import type { QueryState } from '#shared/query';
import type {
  AccountEntity,
  CategoryGroupEntity,
  PayeeEntity,
  TransactionEntity,
} from '#types/models';

import {
  deleteFinancingBreakdown,
  getFinancingBreakdownCandidates,
  getHouseholdFinancingOverview,
  saveFinancingBreakdown,
} from './actuynab-financing';
import {
  configureHousehold,
  getHouseholdOverview,
  loadHouseholdProfile,
} from './actuynab-household';
import {
  confirmImportReview,
  listPendingImportReviews,
  loadImportReview,
  prepareImportReview,
} from './actuynab-review';
import { exportQueryToCSV, exportToCSV } from './export/export-to-csv';
import { parseFile } from './import/parse-file';
import type { ParseFileOptions } from './import/parse-file';
import { mergeTransactions } from './merge';

import { batchUpdateTransactions } from '.';

export type TransactionHandlers = {
  'actuynab-household-configure': typeof configureHousehold;
  'actuynab-household-overview': typeof getHouseholdOverview;
  'actuynab-household-profile': typeof loadHouseholdProfile;
  'actuynab-financing-candidates': typeof getFinancingBreakdownCandidates;
  'actuynab-financing-delete': typeof deleteFinancingBreakdown;
  'actuynab-financing-overview': typeof getHouseholdFinancingOverview;
  'actuynab-financing-save': typeof saveFinancingBreakdown;
  'actuynab-review-confirm': typeof confirmImportReview;
  'actuynab-review-list-pending': typeof listPendingImportReviews;
  'actuynab-review-load': typeof loadImportReview;
  'actuynab-review-prepare': typeof prepareImportReview;
  'transactions-batch-update': typeof handleBatchUpdateTransactions;
  'transaction-add': typeof addTransaction;
  'transaction-update': typeof updateTransaction;
  'transaction-delete': typeof deleteTransaction;
  'transaction-move': typeof moveTransaction;
  'transactions-parse-file': typeof parseTransactionsFile;
  'transactions-export': typeof exportTransactions;
  'transactions-export-query': typeof exportTransactionsQuery;
  'transactions-merge': typeof mergeTransactions;
  'get-earliest-transaction': typeof getEarliestTransaction;
  'get-latest-transaction': typeof getLatestTransaction;
};

async function handleBatchUpdateTransactions({
  added,
  deleted,
  updated,
  learnCategories,
  runTransfers = true,
}: Parameters<typeof batchUpdateTransactions>[0]) {
  const result = await batchUpdateTransactions({
    added,
    updated,
    deleted,
    learnCategories,
    runTransfers,
  });

  return result;
}

async function addTransaction(transaction: TransactionEntity) {
  await handleBatchUpdateTransactions({ added: [transaction] });
  return {};
}

async function updateTransaction(transaction: TransactionEntity) {
  await handleBatchUpdateTransactions({ updated: [transaction] });
  return {};
}

async function deleteTransaction(transaction: Pick<TransactionEntity, 'id'>) {
  await handleBatchUpdateTransactions({ deleted: [transaction] });
  return {};
}

async function moveTransaction({
  id,
  accountId,
  targetId,
}: {
  id: string;
  accountId: string;
  targetId: string | null;
}) {
  // Fetch the transaction to validate it exists and verify account
  const transaction = await db.getTransaction(id);
  if (!transaction) {
    throw new Error(`Transaction not found: ${id}`);
  }

  // Validate that the provided accountId matches the transaction's actual account
  // This prevents sort order calculations against the wrong account
  if (transaction.account !== accountId) {
    throw new Error(
      `Account mismatch: transaction belongs to account ${transaction.account}, not ${accountId}`,
    );
  }

  // Child transactions can be reordered within their parent's children
  // The db.moveTransaction handles the sibling-scoped reordering for children

  await db.moveTransaction(id, accountId, targetId);
  return {};
}

async function parseTransactionsFile({
  filepath,
  options,
}: {
  filepath: string;
  options: ParseFileOptions;
}) {
  return parseFile(filepath, options);
}

async function exportTransactions({
  transactions,
  accounts,
  categoryGroups,
  payees,
}: {
  transactions: TransactionEntity[];
  accounts: AccountEntity[];
  categoryGroups: CategoryGroupEntity[];
  payees: PayeeEntity[];
}) {
  return exportToCSV(transactions, accounts, categoryGroups, payees);
}

async function exportTransactionsQuery({
  query: queryState,
}: {
  query: QueryState;
}) {
  return exportQueryToCSV(new Query(queryState));
}

async function getEarliestTransaction() {
  const { data } = await aqlQuery(
    q('transactions')
      .options({ splits: 'none' })
      .orderBy({ date: 'asc' })
      .select('*')
      .limit(1),
  );
  return data[0] || null;
}

async function getLatestTransaction() {
  const { data } = await aqlQuery(
    q('transactions')
      .options({ splits: 'none' })
      .orderBy({ date: 'desc' })
      .select('*')
      .limit(1),
  );
  return data[0] || null;
}

export const app = createApp<TransactionHandlers>();

app.method(
  'actuynab-household-configure',
  mutator(undoable(configureHousehold)),
);
app.method('actuynab-household-overview', getHouseholdOverview);
app.method('actuynab-household-profile', loadHouseholdProfile);
app.method('actuynab-financing-candidates', getFinancingBreakdownCandidates);
app.method(
  'actuynab-financing-delete',
  mutator(undoable(deleteFinancingBreakdown)),
);
app.method('actuynab-financing-overview', getHouseholdFinancingOverview);
app.method(
  'actuynab-financing-save',
  mutator(undoable(saveFinancingBreakdown)),
);
app.method('actuynab-review-confirm', mutator(undoable(confirmImportReview)));
app.method('actuynab-review-list-pending', listPendingImportReviews);
app.method('actuynab-review-load', loadImportReview);
app.method('actuynab-review-prepare', mutator(prepareImportReview));
app.method(
  'transactions-batch-update',
  mutator(undoable(handleBatchUpdateTransactions)),
);
app.method('transactions-merge', mutator(undoable(mergeTransactions)));

app.method('transaction-add', mutator(addTransaction));
app.method('transaction-update', mutator(updateTransaction));
app.method('transaction-delete', mutator(deleteTransaction));
app.method('transaction-move', mutator(undoable(moveTransaction)));
app.method('transactions-parse-file', mutator(parseTransactionsFile));
app.method('transactions-export', mutator(exportTransactions));
app.method('transactions-export-query', mutator(exportTransactionsQuery));
app.method('get-earliest-transaction', getEarliestTransaction);
app.method('get-latest-transaction', getLatestTransaction);
