import { createHash } from 'node:crypto';

import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import type { TransactionEntity } from '#types/models';

import { classifyHouseholdTransaction } from './actuynab-classification';
import type {
  ClassificationConfidence,
  ClassificationReason,
  HouseholdAccount,
  HouseholdClassificationContext,
  HouseholdClassificationResult,
} from './actuynab-classification';

import { batchUpdateTransactions } from '.';

export type ImportReviewSourceBank = 'activobank' | 'revolut' | 'other';

export type ImportReviewAuditCounts = {
  duplicate?: number;
  failed?: number;
  imported?: number;
  parsed?: number;
  skipped?: number;
  updated?: number;
  warnings?: number;
};

export type PrepareImportReviewInput = {
  accountId: string;
  auditCounts?: ImportReviewAuditCounts;
  sourceBank: ImportReviewSourceBank;
  sourceFormat: string;
  /** Used only to fingerprint an import that reconciled entirely as duplicates. */
  sourceTransactions?: Array<{
    amount: number;
    date: string;
    importedId?: string | null;
    importedPayee?: string | null;
  }>;
  transactionIds: string[];
  updatedTransactionIds?: string[];
};

export type ImportReviewAudit = {
  accountId: string;
  batchId: string;
  confirmedCount: number;
  createdAt: string;
  duplicate: number;
  failed: number;
  imported: number;
  parsed: number;
  reviewStatus: 'pending' | 'confirmed' | 'partially-confirmed';
  skipped: number;
  sourceBank: ImportReviewSourceBank;
  sourceFingerprint: string;
  sourceFormat: string;
  updated: number;
  warnings: number;
};

export type ImportReviewItem = {
  amount: number;
  classification: HouseholdClassificationResult;
  date: string;
  importedPayee: string | null;
  isProtected: boolean;
  possibleDuplicate: boolean;
  protectionReason?: 'reconciled' | 'split' | 'user-classified';
  transactionId: string;
};

export type PreparedImportReview = {
  audit: ImportReviewAudit;
  items: ImportReviewItem[];
};

export type ImportReviewDecision = {
  action: 'approve' | 'correct' | 'reject';
  categoryId?: string | null;
  payeeId?: string | null;
  transactionId: string;
};

export type ConfirmImportReviewInput = {
  batchId: string;
  decisions: ImportReviewDecision[];
};

export type ConfirmedImportReview = {
  applied: string[];
  audit: ImportReviewAudit;
  errors: Array<{
    code:
      | 'missing-transaction'
      | 'protected-transaction'
      | 'unknown-category'
      | 'unknown-payee';
    transactionId: string;
  }>;
  rejected: string[];
};

type ReviewTransactionRow = {
  account: string;
  amount: number;
  category: string | null;
  date: number;
  id: string;
  imported_id: string | null;
  imported_payee: string | null;
  is_child: number;
  is_parent: number;
  payee: string | null;
  payee_name: string | null;
  reconciled: number;
  transfer_id: string | null;
};

type StoredAudit = {
  account_id: string;
  confirmed_count: number;
  created_at: string;
  duplicate: number;
  failed: number;
  id: string;
  imported: number;
  parsed: number;
  review_status: ImportReviewAudit['reviewStatus'];
  skipped: number;
  source_bank: ImportReviewSourceBank;
  source_fingerprint: string;
  source_format: string;
  updated: number;
  warnings: number;
};

type StoredReviewItem = {
  possible_duplicate: number;
  transaction_id: string;
};

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function identifierFor(...parts: string[]): string {
  return stableHash(parts);
}

function toReviewAudit(row: StoredAudit): ImportReviewAudit {
  return {
    accountId: row.account_id,
    batchId: row.id,
    confirmedCount: row.confirmed_count ?? 0,
    createdAt: row.created_at,
    duplicate: row.duplicate ?? 0,
    failed: row.failed ?? 0,
    imported: row.imported ?? 0,
    parsed: row.parsed ?? 0,
    reviewStatus: row.review_status ?? 'pending',
    skipped: row.skipped ?? 0,
    sourceBank: row.source_bank,
    sourceFingerprint: row.source_fingerprint,
    sourceFormat: row.source_format,
    updated: row.updated ?? 0,
    warnings: row.warnings ?? 0,
  };
}

function householdAccount(account: {
  id: string;
  name: string;
  offbudget: number;
}): HouseholdAccount | null {
  const name = account.name.trim().toUpperCase();
  const common = {
    id: account.id,
    name: account.name,
    onBudget: account.offbudget !== 1,
  };

  switch (name) {
    case 'ACTIVO':
      return {
        ...common,
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA ACTIVO'],
      };
    case 'MILLENIUM':
      return {
        ...common,
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA MILLENIUM'],
      };
    case 'CC-ACTIVO-CLASSIC':
      return {
        ...common,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC ACTIVO CLASSIC'],
      };
    case 'CC-MILLENIUM-GOLD':
      return {
        ...common,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC MILLENIUM GOLD'],
      };
    case 'CC-MILLENIUM-CLASSIC':
      return {
        ...common,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC MILLENIUM CLASSIC'],
      };
    case 'TESLA':
      return {
        ...common,
        role: 'vehicle-financing',
        transferDescriptionTokens: ['PAGAMENTO TESLA FINANCIAMENTO'],
      };
    case 'HOME':
      return {
        ...common,
        role: 'mortgage',
        transferDescriptionTokens: ['PRESTACAO CASA HOME'],
      };
    default:
      return null;
  }
}

async function contextForReview(): Promise<HouseholdClassificationContext> {
  const [accounts, payees, history, decisions] = await Promise.all([
    db.getAccounts(),
    db.getPayees(),
    db.all<{
      amount: number;
      category: string | null;
      date: number;
      payee_name: string;
    }>(`
      SELECT t.amount, t.category, t.date, p.name AS payee_name
      FROM v_transactions t
      JOIN payees p ON p.id = t.payee AND p.tombstone = 0
      WHERE t.is_parent = 0
        AND t.tombstone = 0
        AND t.category IS NOT NULL
      ORDER BY t.date DESC
      LIMIT 5000
    `),
    db.all<{
      category_id: string | null;
      normalized_payee: string | null;
      payee_id: string | null;
    }>(`
      SELECT category_id, normalized_payee, payee_id
      FROM actuynab_review_decisions
      WHERE tombstone = 0
        AND decision IN ('approved', 'corrected')
        AND applied = 1
        AND category_id IS NOT NULL
        AND normalized_payee IS NOT NULL
    `),
  ]);

  return {
    accounts: accounts
      .map(householdAccount)
      .filter((account): account is HouseholdAccount => Boolean(account)),
    confirmedPayeeCategories: decisions.flatMap(decision =>
      decision.category_id && decision.normalized_payee
        ? [
            {
              categoryId: decision.category_id,
              normalizedPayee: decision.normalized_payee,
              ...(decision.payee_id ? { payeeId: decision.payee_id } : {}),
            },
          ]
        : [],
    ),
    historicalTransactions: history.map(transaction => ({
      amount: transaction.amount,
      categoryId: transaction.category,
      date: db.fromDateRepr(transaction.date),
      payeeName: transaction.payee_name,
    })),
    knownPayees: payees.map(payee => ({
      id: payee.id,
      name: payee.name,
      transferAccountId: payee.transfer_acct,
    })),
  };
}

async function transactionsByIds(
  ids: string[],
): Promise<ReviewTransactionRow[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return db.all<ReviewTransactionRow>(
    `SELECT t.id, t.account, t.amount, t.category, t.date, t.imported_id,
            t.imported_payee, t.is_child, t.is_parent, t.payee,
            t.reconciled, t.transfer_id, p.name AS payee_name
     FROM v_transactions t
     LEFT JOIN payees p ON p.id = t.payee AND p.tombstone = 0
     WHERE t.id IN (${placeholders}) AND t.tombstone = 0`,
    ids,
  );
}

function protectionFor(
  transaction: ReviewTransactionRow,
): ImportReviewItem['protectionReason'] | undefined {
  if (transaction.reconciled) return 'reconciled';
  if (transaction.is_parent || transaction.is_child) return 'split';
  if (transaction.category) return 'user-classified';
  return undefined;
}

async function itemForTransaction({
  transaction,
  context,
  possibleDuplicate,
}: {
  context: HouseholdClassificationContext;
  possibleDuplicate: boolean;
  transaction: ReviewTransactionRow;
}): Promise<ImportReviewItem> {
  const classification = await classifyHouseholdTransaction(
    {
      account: transaction.account,
      amount: transaction.amount,
      category: transaction.category,
      date: db.fromDateRepr(transaction.date),
      imported_payee: transaction.imported_payee ?? undefined,
      payee: transaction.payee,
      payee_name: transaction.payee_name ?? undefined,
      reconciled: Boolean(transaction.reconciled),
      transfer_id: transaction.transfer_id ?? undefined,
    },
    context,
  );
  const protectionReason = protectionFor(transaction);
  return {
    amount: transaction.amount,
    classification,
    date: db.fromDateRepr(transaction.date),
    importedPayee: transaction.imported_payee,
    isProtected: Boolean(protectionReason),
    possibleDuplicate,
    ...(protectionReason ? { protectionReason } : {}),
    transactionId: transaction.id,
  };
}

async function storedAudit(batchId: string): Promise<StoredAudit | null> {
  return db.first<StoredAudit>(
    'SELECT * FROM actuynab_import_batches WHERE id = ? AND tombstone = 0',
    [batchId],
  );
}

async function ensureReviewItems(
  batchId: string,
  transactionIds: string[],
  possibleDuplicates: ReadonlySet<string>,
) {
  await batchMessages(async () => {
    for (const transactionId of transactionIds) {
      const id = identifierFor(batchId, transactionId);
      const existing = await db.first<{ id: string }>(
        'SELECT id FROM actuynab_import_review_items WHERE id = ? AND tombstone = 0',
        [id],
      );
      if (!existing) {
        await db.insert('actuynab_import_review_items', {
          id,
          batch_id: batchId,
          transaction_id: transactionId,
          possible_duplicate: Number(possibleDuplicates.has(transactionId)),
        });
      }
    }
  });
}

function sourceFingerprint(
  accountId: string,
  sourceBank: ImportReviewSourceBank,
  sourceFormat: string,
  transactions: readonly ReviewTransactionRow[],
  sourceTransactions?: PrepareImportReviewInput['sourceTransactions'],
) {
  const identities = sourceTransactions?.length
    ? sourceTransactions.map(transaction => ({
        amount: transaction.amount,
        date: transaction.date,
        identity:
          transaction.importedId ??
          stableHash({
            amount: transaction.amount,
            date: transaction.date,
            importedPayee: transaction.importedPayee ?? null,
          }),
      }))
    : transactions.map(transaction => ({
        amount: transaction.amount,
        date: transaction.date,
        identity:
          transaction.imported_id ??
          stableHash({
            amount: transaction.amount,
            date: transaction.date,
            importedPayee: transaction.imported_payee,
          }),
      }));
  return stableHash({
    accountId,
    sourceBank,
    sourceFormat,
    transactions: identities.sort((a, b) =>
      a.identity.localeCompare(b.identity),
    ),
  });
}

export async function prepareImportReview(
  input: PrepareImportReviewInput,
): Promise<PreparedImportReview> {
  const transactionIds = [...new Set(input.transactionIds)];
  const transactions = await transactionsByIds(transactionIds);
  const accountTransactions = transactions.filter(
    transaction => transaction.account === input.accountId,
  );
  const fingerprint = sourceFingerprint(
    input.accountId,
    input.sourceBank,
    input.sourceFormat,
    accountTransactions,
    input.sourceTransactions,
  );
  const batchId = identifierFor('actuynab-import-review', fingerprint);
  const counts = input.auditCounts ?? {};
  let audit = await storedAudit(batchId);

  if (!audit) {
    const createdAt = new Date().toISOString();
    await db.insert('actuynab_import_batches', {
      id: batchId,
      account_id: input.accountId,
      source_bank: input.sourceBank,
      source_format: input.sourceFormat,
      created_at: createdAt,
      source_fingerprint: fingerprint,
      parsed: counts.parsed ?? accountTransactions.length,
      imported: counts.imported ?? accountTransactions.length,
      updated: counts.updated ?? 0,
      duplicate: counts.duplicate ?? input.updatedTransactionIds?.length ?? 0,
      skipped: counts.skipped ?? 0,
      failed: counts.failed ?? 0,
      warnings: counts.warnings ?? 0,
      confirmed_count: 0,
      review_status: 'pending',
      processing_errors: null,
    });
    audit = await storedAudit(batchId);
  }

  if (!audit) {
    throw new Error('Unable to create an import-review audit record');
  }

  const possibleDuplicates = new Set(input.updatedTransactionIds ?? []);
  await ensureReviewItems(
    batchId,
    accountTransactions.map(transaction => transaction.id),
    possibleDuplicates,
  );
  const context = await contextForReview();
  const items = await Promise.all(
    accountTransactions.map(transaction =>
      itemForTransaction({
        transaction,
        context,
        possibleDuplicate: possibleDuplicates.has(transaction.id),
      }),
    ),
  );
  return { audit: toReviewAudit(audit), items };
}

export async function loadImportReview({
  batchId,
}: {
  batchId: string;
}): Promise<PreparedImportReview | null> {
  const audit = await storedAudit(batchId);
  if (!audit) return null;
  const storedItems = await db.all<StoredReviewItem>(
    `SELECT transaction_id, possible_duplicate
     FROM actuynab_import_review_items
     WHERE batch_id = ? AND tombstone = 0`,
    [batchId],
  );
  const transactions = await transactionsByIds(
    storedItems.map(item => item.transaction_id),
  );
  const duplicates = new Set(
    storedItems
      .filter(item => item.possible_duplicate)
      .map(item => item.transaction_id),
  );
  const context = await contextForReview();
  return {
    audit: toReviewAudit(audit),
    items: await Promise.all(
      transactions.map(transaction =>
        itemForTransaction({
          transaction,
          context,
          possibleDuplicate: duplicates.has(transaction.id),
        }),
      ),
    ),
  };
}

export async function listPendingImportReviews({
  accountId,
}: {
  accountId: string;
}): Promise<ImportReviewAudit[]> {
  const rows = await db.all<StoredAudit>(
    `SELECT * FROM actuynab_import_batches
     WHERE account_id = ?
       AND tombstone = 0
       AND review_status IN ('pending', 'partially-confirmed')
     ORDER BY created_at DESC`,
    [accountId],
  );
  return rows.map(toReviewAudit);
}

async function validateCategory(id: string | null | undefined) {
  if (!id) return true;
  return Boolean(
    await db.first<{ id: string }>(
      'SELECT id FROM categories WHERE id = ? AND tombstone = 0',
      [id],
    ),
  );
}

async function validatePayee(id: string | null | undefined) {
  if (!id) return true;
  return Boolean(
    await db.first<{ id: string }>(
      'SELECT id FROM payees WHERE id = ? AND tombstone = 0',
      [id],
    ),
  );
}

function structuralClassification(reason: ClassificationReason) {
  return new Set<ClassificationReason>([
    'internal-transfer',
    'credit-card-bill-payment',
    'off-budget-financing-transfer',
    'provided-loan-split-preserved',
    'provided-split-preserved',
  ]).has(reason);
}

export async function confirmImportReview(
  input: ConfirmImportReviewInput,
): Promise<ConfirmedImportReview> {
  const audit = await storedAudit(input.batchId);
  if (!audit) {
    throw new Error('Import review audit record was not found');
  }
  const distinctDecisions = [
    ...new Map(
      input.decisions.map(decision => [decision.transactionId, decision]),
    ).values(),
  ];
  const transactions = await transactionsByIds(
    distinctDecisions.map(decision => decision.transactionId),
  );
  const reviewItems = await db.all<Pick<StoredReviewItem, 'transaction_id'>>(
    `SELECT transaction_id FROM actuynab_import_review_items
     WHERE batch_id = ? AND tombstone = 0`,
    [input.batchId],
  );
  const reviewedTransactionIds = new Set(
    reviewItems.map(item => item.transaction_id),
  );
  const transactionById = new Map(
    transactions.map(transaction => [transaction.id, transaction]),
  );
  const context = await contextForReview();
  const errors: ConfirmedImportReview['errors'] = [];
  const rejected: string[] = [];
  const applied: string[] = [];
  const updates: Partial<TransactionEntity>[] = [];
  const storedDecisions: Array<{
    applied: boolean;
    categoryId: string | null;
    classification: HouseholdClassificationResult;
    decision: ImportReviewDecision;
    payeeId: string | null;
  }> = [];

  for (const decision of distinctDecisions) {
    const transaction = transactionById.get(decision.transactionId);
    if (
      !transaction ||
      transaction.account !== audit.account_id ||
      !reviewedTransactionIds.has(decision.transactionId)
    ) {
      errors.push({
        code: 'missing-transaction',
        transactionId: decision.transactionId,
      });
      continue;
    }
    const item = await itemForTransaction({
      transaction,
      context,
      possibleDuplicate: false,
    });
    const isStructural = structuralClassification(item.classification.reason);
    if (item.isProtected || isStructural) {
      errors.push({
        code: 'protected-transaction',
        transactionId: decision.transactionId,
      });
      continue;
    }

    if (decision.action === 'reject') {
      rejected.push(transaction.id);
      storedDecisions.push({
        applied: false,
        categoryId: null,
        classification: item.classification,
        decision,
        payeeId: null,
      });
      continue;
    }

    const categoryId =
      decision.action === 'correct'
        ? (decision.categoryId ?? null)
        : item.classification.proposedCategoryId;
    const payeeId =
      decision.action === 'correct'
        ? (decision.payeeId ?? null)
        : (item.classification.proposedPayee?.id ?? null);
    if (!(await validateCategory(categoryId))) {
      errors.push({ code: 'unknown-category', transactionId: transaction.id });
      continue;
    }
    if (!(await validatePayee(payeeId))) {
      errors.push({ code: 'unknown-payee', transactionId: transaction.id });
      continue;
    }

    const update: Partial<TransactionEntity> = { id: transaction.id };
    if (categoryId && categoryId !== transaction.category) {
      update.category = categoryId;
    }
    if (payeeId && payeeId !== transaction.payee) {
      update.payee = payeeId;
    }
    if (Object.keys(update).length > 1) {
      updates.push(update);
    }
    applied.push(transaction.id);
    storedDecisions.push({
      applied: true,
      categoryId,
      classification: item.classification,
      decision,
      payeeId,
    });
  }

  if (updates.length > 0) {
    await batchUpdateTransactions({
      updated: updates as TransactionEntity[],
      learnCategories: false,
      runTransfers: false,
    });
  }

  await batchMessages(async () => {
    for (const stored of storedDecisions) {
      const id = identifierFor(input.batchId, stored.decision.transactionId);
      const row = {
        id,
        batch_id: input.batchId,
        transaction_id: stored.decision.transactionId,
        normalized_payee: stored.classification.normalizedPayee,
        payee_id: stored.payeeId,
        category_id: stored.categoryId,
        decision:
          stored.decision.action === 'approve'
            ? 'approved'
            : stored.decision.action === 'correct'
              ? 'corrected'
              : 'rejected',
        reason: stored.classification.reason,
        confidence: stored.classification
          .confidence as ClassificationConfidence,
        applied: Number(stored.applied),
        requires_manual_review: Number(
          stored.classification.requiresManualReview,
        ),
        created_at: new Date().toISOString(),
      };
      const existing = await db.first<{ id: string }>(
        'SELECT id FROM actuynab_review_decisions WHERE id = ? AND tombstone = 0',
        [id],
      );
      if (existing) {
        await db.update('actuynab_review_decisions', row);
      } else {
        await db.insert('actuynab_review_decisions', row);
      }
    }
  });

  const [reviewItemCount, persistedDecisionCount] = await Promise.all([
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM actuynab_import_review_items
       WHERE batch_id = ? AND tombstone = 0`,
      [input.batchId],
    ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM actuynab_review_decisions
       WHERE batch_id = ? AND tombstone = 0`,
      [input.batchId],
    ),
  ]);
  const itemCount = reviewItemCount?.count ?? 0;
  const confirmedCount = persistedDecisionCount?.count ?? 0;
  const reviewStatus: ImportReviewAudit['reviewStatus'] =
    confirmedCount === 0
      ? 'pending'
      : confirmedCount < itemCount || errors.length > 0
        ? 'partially-confirmed'
        : 'confirmed';
  await db.update('actuynab_import_batches', {
    id: input.batchId,
    confirmed_count: confirmedCount,
    review_status: reviewStatus,
    processing_errors: errors.length
      ? JSON.stringify(errors.map(error => error.code))
      : null,
  });
  const updatedAudit = await storedAudit(input.batchId);
  if (!updatedAudit) {
    throw new Error(
      'Import review audit record disappeared after confirmation',
    );
  }
  return { applied, audit: toReviewAudit(updatedAudit), errors, rejected };
}
