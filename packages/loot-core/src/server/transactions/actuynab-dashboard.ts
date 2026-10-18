import { getSheetValue } from '#server/budget/actions';
import * as db from '#server/db';
import * as monthUtils from '#shared/months';

import { getHouseholdFinancingOverview } from './actuynab-financing';
import {
  getHouseholdOverview,
  loadHouseholdProfile,
} from './actuynab-household';

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
  financing: HouseholdDashboardFinancingAccount[];
  isConfigured: boolean;
  month: string;
  monthly: HouseholdDashboardMonthlySummary;
  overview: Awaited<ReturnType<typeof getHouseholdOverview>>;
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
      spendingTrends: [],
    };
  }
  const onBudgetIds = profile.accounts
    .filter(account => account.onBudget)
    .map(account => account.id);
  const [monthly, spendingTrends] = await Promise.all([
    getMonthlyLedgerSummary({ accountIds: onBudgetIds, month }),
    getSpendingTrends({ accountIds: onBudgetIds, month }),
  ]);
  return {
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
    spendingTrends,
  };
}
