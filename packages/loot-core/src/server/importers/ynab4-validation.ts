import { amountToInteger } from '#shared/util';

import type * as YNAB4 from './ynab4-types';

type SourceEntityId = string;

export type Ynab4MigrationDestination = {
  accounts: Array<{
    sourceId: SourceEntityId;
    balance: number;
  }>;
  categories: Array<{
    sourceId: SourceEntityId;
  }>;
  payees: Array<{
    sourceId: SourceEntityId;
  }>;
  transactions: Array<{
    sourceId: SourceEntityId;
    accountSourceId: SourceEntityId;
    amount: number;
    isChild: boolean;
    isParent: boolean;
    parentSourceId: SourceEntityId | null;
    categorySourceId: SourceEntityId | null;
    transferSourceId: SourceEntityId | null;
    cleared: boolean;
    reconciled: boolean;
  }>;
  budgetAllocations: Array<{
    month: string;
    categorySourceId: SourceEntityId;
    amount: number;
    carryover: boolean | null;
  }>;
  scheduledTransactionCount: number;
  payeeRuleCount: number;
};

export type Ynab4MigrationDiscrepancy = {
  kind: 'financial' | 'expected-model-difference';
  severity: 'error' | 'info';
  check: string;
  entity: string;
  expected: number | string | boolean | null;
  actual: number | string | boolean | null;
  reason: string;
};

export type Ynab4MigrationReport = {
  schemaVersion: 1;
  source: {
    budgetDataVersion: string;
    sourceFingerprint: string | null;
    counts: {
      accounts: number;
      categories: number;
      payees: number;
      transactions: number;
      splitTransactions: number;
      splitChildren: number;
      transferRelationships: number;
      monthlyBudgetAllocations: number;
      scheduledTransactions: number;
      payeeRules: number;
      reconciledTransactions: number;
    };
  };
  destination: {
    counts: {
      accounts: number;
      categories: number;
      payees: number;
      transactions: number;
      splitTransactions: number;
      splitChildren: number;
      transferRelationships: number;
      monthlyBudgetAllocations: number;
      scheduledTransactions: number;
      payeeRules: number;
      reconciledTransactions: number;
    };
  };
  checks: Array<{
    name: string;
    expected: number;
    actual: number;
    status: 'passed' | 'failed';
  }>;
  discrepancies: Ynab4MigrationDiscrepancy[];
  outcome: 'passed' | 'financial-discrepancies';
};

type SourceTransaction = {
  sourceId: SourceEntityId;
  parentSourceId: SourceEntityId | null;
  accountSourceId: SourceEntityId;
  amount: number;
  isChild: boolean;
  isParent: boolean;
  categorySourceId: SourceEntityId | null;
  transferSourceId: SourceEntityId | null;
  cleared: boolean;
  reconciled: boolean;
};

type SourceBudgetAllocation = {
  month: string;
  categorySourceId: SourceEntityId;
  amount: number;
  carryover: boolean | null;
};

function isLive(entity: { isTombstone?: boolean }) {
  return !entity.isTombstone;
}

function transactionState(cleared: string | undefined) {
  return {
    cleared: cleared === 'Cleared' || cleared === 'Reconciled',
    reconciled: cleared === 'Reconciled',
  };
}

function comparableCategoryId(categoryId: string | null | undefined) {
  if (
    categoryId == null ||
    categoryId === 'Category/__Split__' ||
    categoryId === 'Category/__ImmediateIncome__' ||
    categoryId === 'Category/__DeferredIncome__'
  ) {
    return null;
  }
  return categoryId;
}

function sourceTransactions(data: YNAB4.YFull): SourceTransaction[] {
  const transactions: SourceTransaction[] = [];

  for (const transaction of data.transactions.filter(isLive)) {
    const children = transaction.subTransactions?.filter(isLive) ?? [];
    const state = transactionState(transaction.cleared);

    transactions.push({
      sourceId: transaction.entityId,
      parentSourceId: null,
      accountSourceId: transaction.accountId,
      amount: amountToInteger(transaction.amount),
      isChild: false,
      isParent: children.length > 0,
      categorySourceId: comparableCategoryId(transaction.categoryId),
      transferSourceId: transaction.transferTransactionId ?? null,
      ...state,
    });

    for (const child of children) {
      transactions.push({
        sourceId: child.entityId,
        parentSourceId: transaction.entityId,
        accountSourceId: transaction.accountId,
        amount: amountToInteger(child.amount),
        isChild: true,
        isParent: false,
        categorySourceId: comparableCategoryId(child.categoryId),
        transferSourceId: child.transferTransactionId ?? null,
        // YNAB 4 represents a split's reconciliation state on its parent.
        // Actual persists that state on every resulting child row.
        ...state,
      });
    }
  }

  return transactions;
}

function sourceBudgetAllocations(data: YNAB4.YFull): SourceBudgetAllocation[] {
  const categoryIds = data.masterCategories.flatMap(masterCategory =>
    masterCategory.type === 'OUTFLOW' && isLive(masterCategory)
      ? (masterCategory.subCategories ?? [])
          .filter(isLive)
          .map(category => category.entityId)
      : [],
  );

  return data.monthlyBudgets.flatMap(budget =>
    categoryIds.map(categoryId => {
      const categoryBudget = budget.monthlySubCategoryBudgets.find(
        candidate => candidate.categoryId === categoryId && isLive(candidate),
      );
      return {
        month: budget.month.slice(0, 7),
        categorySourceId: categoryId,
        amount: amountToInteger(categoryBudget?.budgeted ?? 0),
        carryover:
          categoryBudget?.overspendingHandling === 'Confined'
            ? true
            : categoryBudget?.overspendingHandling === 'AffectsBuffer'
              ? false
              : null,
      };
    }),
  );
}

function transferPairs(
  transactions: Array<Pick<SourceTransaction, 'sourceId' | 'transferSourceId'>>,
) {
  const ids = new Set(transactions.map(transaction => transaction.sourceId));
  const pairs = new Set<string>();

  for (const transaction of transactions) {
    if (transaction.transferSourceId && ids.has(transaction.transferSourceId)) {
      pairs.add(
        [transaction.sourceId, transaction.transferSourceId].sort().join(':'),
      );
    }
  }

  return pairs;
}

function countSplitTransactions(
  transactions: Array<Pick<SourceTransaction, 'isParent'>>,
) {
  return transactions.filter(transaction => transaction.isParent).length;
}

function destinationCounts(destination: Ynab4MigrationDestination) {
  const transfers = transferPairs(destination.transactions);
  return {
    accounts: destination.accounts.length,
    categories: destination.categories.length,
    payees: destination.payees.length,
    transactions: destination.transactions.filter(
      transaction => !transaction.isChild,
    ).length,
    splitTransactions: countSplitTransactions(destination.transactions),
    splitChildren: destination.transactions.filter(
      transaction => transaction.isChild,
    ).length,
    transferRelationships: transfers.size,
    monthlyBudgetAllocations: destination.budgetAllocations.length,
    scheduledTransactions: destination.scheduledTransactionCount,
    payeeRules: destination.payeeRuleCount,
    reconciledTransactions: destination.transactions.filter(
      transaction => transaction.reconciled,
    ).length,
  };
}

function addFinancialDiscrepancy(
  discrepancies: Ynab4MigrationDiscrepancy[],
  check: string,
  entity: string,
  expected: number | string | boolean | null,
  actual: number | string | boolean | null,
  reason: string,
) {
  discrepancies.push({
    kind: 'financial',
    severity: 'error',
    check,
    entity,
    expected,
    actual,
    reason,
  });
}

function addExpectedDifference(
  discrepancies: Ynab4MigrationDiscrepancy[],
  check: string,
  entity: string,
  expected: number | string | boolean | null,
  actual: number | string | boolean | null,
  reason: string,
) {
  discrepancies.push({
    kind: 'expected-model-difference',
    severity: 'info',
    check,
    entity,
    expected,
    actual,
    reason,
  });
}

function markdownCell(value: string | number | boolean | null) {
  return String(value ?? 'null')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

/**
 * Compares a parsed YNAB 4 budget with a snapshot collected from the newly
 * created Actual budget. The caller supplies only IDs and financial values;
 * transaction descriptions and notes are intentionally omitted from reports.
 */
export function buildYnab4MigrationReport(
  data: YNAB4.YFull,
  destination: Ynab4MigrationDestination,
  options: { sourceFingerprint?: string } = {},
): Ynab4MigrationReport {
  const accounts = data.accounts.filter(isLive);
  const categories = data.masterCategories.flatMap(masterCategory =>
    masterCategory.type === 'OUTFLOW' && isLive(masterCategory)
      ? (masterCategory.subCategories ?? []).filter(isLive)
      : [],
  );
  const payees = data.payees.filter(isLive);
  const transactions = sourceTransactions(data);
  const budgets = sourceBudgetAllocations(data);
  const transferRelationships = transferPairs(transactions);
  const sourceCounts = {
    accounts: accounts.length,
    categories: categories.length,
    payees: payees.length,
    transactions: transactions.filter(transaction => !transaction.isChild)
      .length,
    splitTransactions: countSplitTransactions(transactions),
    splitChildren: transactions.filter(transaction => transaction.isChild)
      .length,
    transferRelationships: transferRelationships.size,
    monthlyBudgetAllocations: budgets.length,
    scheduledTransactions: data.scheduledTransactions.filter(isLive).length,
    payeeRules: payees.reduce(
      (count, payee) => count + (payee.renameConditions?.length ?? 0),
      0,
    ),
    reconciledTransactions: transactions.filter(
      transaction => transaction.reconciled,
    ).length,
  };
  const targetCounts = destinationCounts(destination);
  const discrepancies: Ynab4MigrationDiscrepancy[] = [];
  const checks: Ynab4MigrationReport['checks'] = [];

  const sourceBalanceByAccount = new Map<string, number>();
  for (const transaction of transactions) {
    if (!transaction.isParent) {
      sourceBalanceByAccount.set(
        transaction.accountSourceId,
        (sourceBalanceByAccount.get(transaction.accountSourceId) ?? 0) +
          transaction.amount,
      );
    }
  }
  const targetBalanceByAccount = new Map(
    destination.accounts.map(account => [account.sourceId, account.balance]),
  );
  for (const account of accounts) {
    const expected = sourceBalanceByAccount.get(account.entityId) ?? 0;
    const actual = targetBalanceByAccount.get(account.entityId) ?? null;
    if (actual !== expected) {
      addFinancialDiscrepancy(
        discrepancies,
        'account-balance',
        `account:${account.entityId}`,
        expected,
        actual,
        'The imported account ledger does not equal the YNAB 4 source ledger.',
      );
    }
  }

  const sourceLedgerTotal = transactions
    .filter(transaction => !transaction.isParent)
    .reduce((total, transaction) => total + transaction.amount, 0);
  const targetLedgerTotal = destination.transactions
    .filter(transaction => !transaction.isParent)
    .reduce((total, transaction) => total + transaction.amount, 0);
  checks.push({
    name: 'aggregate-transaction-amount',
    expected: sourceLedgerTotal,
    actual: targetLedgerTotal,
    status: sourceLedgerTotal === targetLedgerTotal ? 'passed' : 'failed',
  });
  if (sourceLedgerTotal !== targetLedgerTotal) {
    addFinancialDiscrepancy(
      discrepancies,
      'aggregate-transaction-amount',
      'budget',
      sourceLedgerTotal,
      targetLedgerTotal,
      'The aggregate imported ledger amount differs from the source.',
    );
  }

  for (const [name, expected, actual] of [
    ['accounts', sourceCounts.accounts, targetCounts.accounts],
    ['categories', sourceCounts.categories, targetCounts.categories],
    ['payees', sourceCounts.payees, targetCounts.payees],
    ['transactions', sourceCounts.transactions, targetCounts.transactions],
    [
      'transfer-relationships',
      sourceCounts.transferRelationships,
      targetCounts.transferRelationships,
    ],
    [
      'reconciled-transactions',
      sourceCounts.reconciledTransactions,
      targetCounts.reconciledTransactions,
    ],
  ] as const) {
    checks.push({
      name,
      expected,
      actual,
      status: expected === actual ? 'passed' : 'failed',
    });
    if (expected !== actual) {
      addFinancialDiscrepancy(
        discrepancies,
        name,
        'budget',
        expected,
        actual,
        'The source and destination counts differ.',
      );
    }
  }

  const targetCategoryIds = new Set(
    destination.categories.map(category => category.sourceId),
  );
  for (const category of categories) {
    if (!targetCategoryIds.has(category.entityId)) {
      addFinancialDiscrepancy(
        discrepancies,
        'category-mapping',
        `category:${category.entityId}`,
        true,
        false,
        'The source category has no destination mapping.',
      );
    }
  }

  const targetPayeeIds = new Set(
    destination.payees.map(payee => payee.sourceId),
  );
  for (const payee of payees) {
    if (!targetPayeeIds.has(payee.entityId)) {
      addFinancialDiscrepancy(
        discrepancies,
        'payee-mapping',
        `payee:${payee.entityId}`,
        true,
        false,
        'The source payee has no destination mapping.',
      );
    }
  }

  const targetBySourceId = new Map(
    destination.transactions.map(transaction => [
      transaction.sourceId,
      transaction,
    ]),
  );
  for (const transaction of transactions) {
    const target = targetBySourceId.get(transaction.sourceId);
    if (!target) {
      addFinancialDiscrepancy(
        discrepancies,
        'transaction-mapping',
        `transaction:${transaction.sourceId}`,
        true,
        false,
        'The source transaction has no destination mapping.',
      );
      continue;
    }
    if (target.amount !== transaction.amount) {
      addFinancialDiscrepancy(
        discrepancies,
        'transaction-amount',
        `transaction:${transaction.sourceId}`,
        transaction.amount,
        target.amount,
        'The imported transaction amount differs from the source.',
      );
    }
    if (target.accountSourceId !== transaction.accountSourceId) {
      addFinancialDiscrepancy(
        discrepancies,
        'transaction-account',
        `transaction:${transaction.sourceId}`,
        transaction.accountSourceId,
        target.accountSourceId,
        'The imported transaction is assigned to a different account.',
      );
    }
    if (target.categorySourceId !== transaction.categorySourceId) {
      addFinancialDiscrepancy(
        discrepancies,
        'transaction-category',
        `transaction:${transaction.sourceId}`,
        transaction.categorySourceId,
        target.categorySourceId,
        'The imported transaction category differs from the source.',
      );
    }
    if (target.transferSourceId !== transaction.transferSourceId) {
      addFinancialDiscrepancy(
        discrepancies,
        'transfer-relationship',
        `transaction:${transaction.sourceId}`,
        transaction.transferSourceId,
        target.transferSourceId,
        'The imported transfer link differs from the source.',
      );
    }
    if (target.cleared !== transaction.cleared) {
      addFinancialDiscrepancy(
        discrepancies,
        'cleared-state',
        `transaction:${transaction.sourceId}`,
        transaction.cleared,
        target.cleared,
        'The imported cleared state differs from the source.',
      );
    }
    if (target.reconciled !== transaction.reconciled) {
      addFinancialDiscrepancy(
        discrepancies,
        'reconciliation-state',
        `transaction:${transaction.sourceId}`,
        transaction.reconciled,
        target.reconciled,
        'The imported reconciled state differs from the source.',
      );
    }
  }

  for (const splitParent of transactions.filter(
    transaction => transaction.isParent,
  )) {
    const expected = transactions
      .filter(
        transaction => transaction.parentSourceId === splitParent.sourceId,
      )
      .reduce((total, transaction) => total + transaction.amount, 0);
    const actual = destination.transactions
      .filter(
        transaction => transaction.parentSourceId === splitParent.sourceId,
      )
      .reduce((total, transaction) => total + transaction.amount, 0);
    if (expected !== actual) {
      addFinancialDiscrepancy(
        discrepancies,
        'split-total',
        `transaction:${splitParent.sourceId}`,
        expected,
        actual,
        'The destination split children do not sum to the source split.',
      );
    }
  }

  const targetBudgets = new Map(
    destination.budgetAllocations.map(allocation => [
      `${allocation.month}:${allocation.categorySourceId}`,
      allocation,
    ]),
  );
  for (const allocation of budgets) {
    const entity = `budget:${allocation.month}:${allocation.categorySourceId}`;
    const target = targetBudgets.get(
      `${allocation.month}:${allocation.categorySourceId}`,
    );
    if (!target || target.amount !== allocation.amount) {
      addFinancialDiscrepancy(
        discrepancies,
        'budget-allocation',
        entity,
        allocation.amount,
        target?.amount ?? null,
        'The monthly budget allocation differs from the source.',
      );
    }
    if (
      allocation.carryover !== null &&
      target?.carryover !== allocation.carryover
    ) {
      addFinancialDiscrepancy(
        discrepancies,
        'budget-carryover',
        entity,
        allocation.carryover,
        target?.carryover ?? null,
        'The monthly rollover setting differs from the source.',
      );
    }
  }

  if (sourceCounts.scheduledTransactions > 0) {
    addExpectedDifference(
      discrepancies,
      'scheduled-transactions',
      'budget',
      sourceCounts.scheduledTransactions,
      targetCounts.scheduledTransactions,
      'YNAB 4 scheduled transactions are parsed but are not imported by the existing importer.',
    );
  }
  if (sourceCounts.payeeRules > 0) {
    addExpectedDifference(
      discrepancies,
      'payee-rules',
      'budget',
      sourceCounts.payeeRules,
      targetCounts.payeeRules,
      'YNAB 4 payee rename rules are not imported by the existing importer.',
    );
  }
  if (accounts.some(account => account.accountType.length > 0)) {
    addExpectedDifference(
      discrepancies,
      'account-types',
      'budget',
      accounts.length,
      0,
      'Actual accounts do not retain a YNAB 4 account-type classification.',
    );
  }
  if (accounts.some(account => account.lastReconciledBalance !== 0)) {
    addExpectedDifference(
      discrepancies,
      'reconciliation-checkpoints',
      'budget',
      accounts.filter(account => account.lastReconciledBalance !== 0).length,
      0,
      'Individual reconciled transaction states are imported, but YNAB 4 account reconciliation checkpoints are not.',
    );
  }

  return {
    schemaVersion: 1,
    source: {
      budgetDataVersion: data.fileMetaData.budgetDataVersion,
      sourceFingerprint: options.sourceFingerprint ?? null,
      counts: sourceCounts,
    },
    destination: { counts: targetCounts },
    checks,
    discrepancies,
    outcome: discrepancies.some(discrepancy => discrepancy.kind === 'financial')
      ? 'financial-discrepancies'
      : 'passed',
  };
}

export function formatYnab4MigrationReportJson(report: Ynab4MigrationReport) {
  return JSON.stringify(report, null, 2) + '\n';
}

export function formatYnab4MigrationReportMarkdown(
  report: Ynab4MigrationReport,
) {
  const lines = [
    '# YNAB 4 migration validation report',
    '',
    `Outcome: **${report.outcome}**`,
    '',
    '## Counts',
    '',
    '| Entity | Source | Destination |',
    '| --- | ---: | ---: |',
  ];

  for (const key of Object.keys(report.source.counts) as Array<
    keyof Ynab4MigrationReport['source']['counts']
  >) {
    const expected = report.source.counts[key];
    lines.push(`| ${key} | ${expected} | ${report.destination.counts[key]} |`);
  }

  lines.push(
    '',
    '## Checks',
    '',
    '| Check | Expected | Actual | Status |',
    '| --- | ---: | ---: | --- |',
  );
  for (const check of report.checks) {
    lines.push(
      `| ${check.name} | ${check.expected} | ${check.actual} | ${check.status} |`,
    );
  }

  lines.push(
    '',
    '## Discrepancies',
    '',
    '| Kind | Check | Entity | Expected | Actual | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  if (report.discrepancies.length === 0) {
    lines.push('| none | - | - | - | - | No differences detected. |');
  } else {
    for (const discrepancy of report.discrepancies) {
      lines.push(
        `| ${discrepancy.kind} | ${discrepancy.check} | ${markdownCell(discrepancy.entity)} | ${markdownCell(discrepancy.expected)} | ${markdownCell(discrepancy.actual)} | ${markdownCell(discrepancy.reason)} |`,
      );
    }
  }

  return lines.join('\n') + '\n';
}
