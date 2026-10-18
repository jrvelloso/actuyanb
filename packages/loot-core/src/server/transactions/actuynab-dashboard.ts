import { getSheetBoolean, getSheetValue } from '#server/budget/actions';
import * as db from '#server/db';
import * as monthUtils from '#shared/months';

import { getHouseholdFinancingOverview } from './actuynab-financing';
import {
  getHouseholdOverview,
  loadHouseholdProfile,
} from './actuynab-household';
import { listPendingImportReviews, loadImportReview } from './actuynab-review';

export type HouseholdDashboardBudgetCategory = {
  balance: number;
  budgeted: number;
  carriesOver: boolean;
  categoryId: string;
  categoryName: string;
  groupName: string;
  spent: number;
};

export type HouseholdDashboardDailyBudget = {
  categories: HouseholdDashboardBudgetCategory[];
  hasBudgetData: boolean;
  remaining: number;
};

export type HouseholdDashboardPendingReview = {
  accountId: string;
  accountName: string;
  batchId: string;
  creditCardPaymentCount: number;
  createdAt: string;
  itemCount: number;
  manualReviewCount: number;
  sourceBank: string;
  sourceFormat: string;
  transferCount: number;
};

export type HouseholdDashboardMonthlySummary = {
  actualSpending: number;
  budgetedSpending: number;
  hasBudgetedSpending: boolean;
  income: number;
};

export type HouseholdDashboardCategoryTrend = {
  categoryId: string;
  categoryName: string;
  months: Array<{
    amount: number;
    month: string;
  }>;
  total: number;
};

export type HouseholdDashboardFinancingAccount = {
  accountId: string;
  accountName: string;
  knownInsurance: number;
  knownInterest: number;
  knownPrincipal: number;
  needsReviewCount: number;
  outstandingBalance: number;
};

export type HouseholdDashboard = {
  dailyBudget: HouseholdDashboardDailyBudget;
  financing: HouseholdDashboardFinancingAccount[];
  isConfigured: boolean;
  month: string;
  monthly: HouseholdDashboardMonthlySummary;
  overview: Awaited<ReturnType<typeof getHouseholdOverview>>;
  pendingReviews: HouseholdDashboardPendingReview[];
  spendingTrends: HouseholdDashboardCategoryTrend[];
};

type MonthlyLedgerSummary = {
  actual_spending: number;
  income: number;
};

type SpendingTrendRow = {
  amount: number;
  category_id: string;
  category_name: string;
  month: number;
};

function monthFromDateRepr(date: number) {
  const value = String(date);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
}

function financedAmount(
  amount: (installment: {
    insuranceAmount: number;
    interestAmount: number;
    principalAmount: number;
  }) => number,
  installments: Array<{
    insuranceAmount: number;
    interestAmount: number;
    paymentDate: string;
    paymentDirection: 'payment' | 'refund';
    principalAmount: number;
    status: 'verified' | 'needs-review';
  }>,
  month: string,
) {
  return installments
    .filter(
      installment =>
        installment.status === 'verified' &&
        installment.paymentDate.startsWith(month),
    )
    .reduce(
      (total, installment) =>
        total +
        (installment.paymentDirection === 'payment' ? 1 : -1) *
          amount(installment),
      0,
    );
}

async function getBudgetedSpending(month: string) {
  try {
    const categories = (await db.getCategoriesGrouped()).flatMap(group =>
      (group.categories ?? []).filter(category => category.is_income === 0),
    );
    const values = await Promise.all(
      categories.map(category =>
        getSheetValue(monthUtils.sheetForMonth(month), `budget-${category.id}`),
      ),
    );
    return {
      amount: values.reduce((total, amount) => total + amount, 0),
      hasBudgetedSpending: true,
    };
  } catch {
    // A fresh budget may not have initialized a spreadsheet for this month.
    // Treat that as unavailable rather than presenting an invented budget.
    return { amount: 0, hasBudgetedSpending: false };
  }
}

async function getDailyBudget(
  month: string,
): Promise<HouseholdDashboardDailyBudget> {
  try {
    const sheetName = monthUtils.sheetForMonth(month);
    const groups = await db.getCategoriesGrouped();
    const categories = groups.flatMap(group =>
      (group.categories ?? [])
        .filter(
          category =>
            category.is_income === 0 &&
            category.hidden !== 1 &&
            group.hidden !== 1,
        )
        .map(category => ({ category, groupName: group.name })),
    );
    const [remaining, values] = await Promise.all([
      getSheetValue(sheetName, 'total-leftover'),
      Promise.all(
        categories.map(async ({ category, groupName }) => {
          const [budgeted, sumAmount, balance, carriesOver] = await Promise.all(
            [
              getSheetValue(sheetName, `budget-${category.id}`),
              getSheetValue(sheetName, `sum-amount-${category.id}`),
              getSheetValue(sheetName, `leftover-${category.id}`),
              getSheetBoolean(sheetName, `carryover-${category.id}`),
            ],
          );
          return {
            balance,
            budgeted,
            carriesOver,
            categoryId: category.id,
            categoryName: category.name,
            groupName,
            // Actual's budget sheet stores expense activity as a negative
            // amount. Only its display direction changes here; the value is
            // still the native cell, not a dashboard calculation.
            spent: -sumAmount,
          };
        }),
      ),
    ]);
    return { categories: values, hasBudgetData: true, remaining };
  } catch {
    // A fresh budget may not yet have a populated spreadsheet. Avoid showing
    // a fabricated zero-value category summary in that case.
    return { categories: [], hasBudgetData: false, remaining: 0 };
  }
}

async function getPendingReviewQueue(
  profile: NonNullable<Awaited<ReturnType<typeof loadHouseholdProfile>>>,
): Promise<HouseholdDashboardPendingReview[]> {
  const auditsByAccount = await Promise.all(
    profile.accounts.map(async account => ({
      account,
      audits: await listPendingImportReviews({ accountId: account.id }),
    })),
  );
  const audits = auditsByAccount.flatMap(({ account, audits }) =>
    audits.map(audit => ({ account, audit })),
  );
  const pending = await Promise.all(
    audits.map(async ({ account, audit }) => {
      const review = await loadImportReview({ batchId: audit.batchId });
      const items = review?.items ?? [];
      return {
        accountId: account.id,
        accountName: account.name,
        batchId: audit.batchId,
        creditCardPaymentCount: items.filter(
          item => item.classification.reason === 'credit-card-bill-payment',
        ).length,
        createdAt: audit.createdAt,
        itemCount: items.length,
        manualReviewCount: items.filter(
          item => item.classification.requiresManualReview,
        ).length,
        sourceBank: audit.sourceBank,
        sourceFormat: audit.sourceFormat,
        transferCount: items.filter(
          item =>
            item.classification.reason === 'internal-transfer' ||
            item.classification.reason === 'off-budget-financing-transfer',
        ).length,
      };
    }),
  );
  return pending.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

async function getMonthlyLedgerSummary({
  accountIds,
  month,
}: {
  accountIds: readonly string[];
  month: string;
}): Promise<HouseholdDashboardMonthlySummary> {
  if (accountIds.length === 0) {
    return {
      actualSpending: 0,
      budgetedSpending: 0,
      hasBudgetedSpending: false,
      income: 0,
    };
  }
  const { start, end } = monthUtils.bounds(month);
  const [summary, budgeted] = await Promise.all([
    db.first<MonthlyLedgerSummary>(
      `SELECT
         COALESCE(SUM(CASE WHEN c.is_income = 1 THEN t.amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN c.is_income = 0 THEN -t.amount ELSE 0 END), 0) AS actual_spending
       FROM v_transactions t
       JOIN categories c ON c.id = t.category AND c.tombstone = 0
       WHERE t.account IN (${accountIds.map(() => '?').join(', ')})
         AND t.category IS NOT NULL
         AND t.is_parent = 0
         AND t.date BETWEEN ? AND ?`,
      [...accountIds, start, end],
    ),
    getBudgetedSpending(month),
  ]);
  return {
    actualSpending: summary?.actual_spending ?? 0,
    budgetedSpending: budgeted.amount,
    hasBudgetedSpending: budgeted.hasBudgetedSpending,
    income: summary?.income ?? 0,
  };
}

async function getSpendingTrends({
  accountIds,
  month,
}: {
  accountIds: readonly string[];
  month: string;
}): Promise<HouseholdDashboardCategoryTrend[]> {
  if (accountIds.length === 0) return [];
  const months = monthUtils.rangeInclusive(
    monthUtils.subMonths(month, 5),
    month,
  );
  const { start } = monthUtils.bounds(months[0]);
  const { end } = monthUtils.bounds(months.at(-1) ?? month);
  const rows = await db.all<SpendingTrendRow>(
    `SELECT
       t.category AS category_id,
       c.name AS category_name,
       CAST(t.date / 100 AS INTEGER) AS month,
       COALESCE(SUM(-t.amount), 0) AS amount
     FROM v_transactions t
     JOIN categories c ON c.id = t.category AND c.tombstone = 0
     WHERE t.account IN (${accountIds.map(() => '?').join(', ')})
       AND t.category IS NOT NULL
       AND t.is_parent = 0
       AND c.is_income = 0
       AND t.date BETWEEN ? AND ?
     GROUP BY t.category, c.name, CAST(t.date / 100 AS INTEGER)
     HAVING SUM(-t.amount) != 0`,
    [...accountIds, start, end],
  );
  const byCategory = new Map<
    string,
    {
      amounts: Map<string, number>;
      categoryName: string;
      total: number;
    }
  >();
  for (const row of rows) {
    const trend = byCategory.get(row.category_id) ?? {
      amounts: new Map<string, number>(),
      categoryName: row.category_name,
      total: 0,
    };
    const rowMonth = monthFromDateRepr(row.month);
    trend.amounts.set(
      rowMonth,
      (trend.amounts.get(rowMonth) ?? 0) + row.amount,
    );
    trend.total += row.amount;
    byCategory.set(row.category_id, trend);
  }
  return [...byCategory.entries()]
    .map(([categoryId, trend]) => ({
      categoryId,
      categoryName: trend.categoryName,
      months: months.map(item => ({
        amount: trend.amounts.get(item) ?? 0,
        month: item,
      })),
      total: trend.total,
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 5);
}

/**
 * A read-only household dashboard projection. Ledger amounts and budget-sheet
 * values remain owned by Actual; verified M10 allocations are descriptive
 * metadata and are never added to an account balance or expense total.
 */
export async function getHouseholdDashboard({
  month = monthUtils.currentMonth(),
}: {
  month?: string;
} = {}): Promise<HouseholdDashboard> {
  if (!monthUtils.isValidYearMonth(month)) {
    throw new Error('Choose a valid dashboard month.');
  }
  const profile = await loadHouseholdProfile();
  const [overview, financing] = await Promise.all([
    getHouseholdOverview({ month }),
    getHouseholdFinancingOverview(),
  ]);
  if (!profile) {
    return {
      dailyBudget: { categories: [], hasBudgetData: false, remaining: 0 },
      financing: [],
      isConfigured: false,
      month,
      monthly: {
        actualSpending: 0,
        budgetedSpending: 0,
        hasBudgetedSpending: false,
        income: 0,
      },
      overview,
      pendingReviews: [],
      spendingTrends: [],
    };
  }
  const onBudgetIds = profile.accounts
    .filter(account => account.onBudget)
    .map(account => account.id);
  const [dailyBudget, monthly, pendingReviews, spendingTrends] =
    await Promise.all([
      getDailyBudget(month),
      getMonthlyLedgerSummary({ accountIds: onBudgetIds, month }),
      getPendingReviewQueue(profile),
      getSpendingTrends({ accountIds: onBudgetIds, month }),
    ]);
  return {
    dailyBudget,
    financing: financing.accounts.map(account => ({
      accountId: account.accountId,
      accountName: account.accountName,
      knownInsurance: financedAmount(
        installment => installment.insuranceAmount,
        account.installments,
        month,
      ),
      knownInterest: financedAmount(
        installment => installment.interestAmount,
        account.installments,
        month,
      ),
      knownPrincipal: financedAmount(
        installment => installment.principalAmount,
        account.installments,
        month,
      ),
      needsReviewCount: account.needsReviewCount,
      outstandingBalance: account.outstandingBalance,
    })),
    isConfigured: true,
    month,
    monthly,
    overview,
    pendingReviews,
    spendingTrends,
  };
}
