import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type {
  HouseholdDashboardCategoryTrend,
  HouseholdDashboard as HouseholdDashboardData,
} from '@actual-app/core/server/transactions/actuynab-dashboard';
import * as monthUtils from '@actual-app/core/shared/months';

import { FinancialText } from '#components/FinancialText';
import { MonthInput } from '#components/util/MonthInput';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';

import { DailyBudget, ImportReviewQueue } from './HouseholdDailyBudget';

type DashboardCardProps = {
  children: ReactNode;
  title: ReactNode;
};

type HouseholdDashboardPanelProps = {
  dashboard: HouseholdDashboardData;
  month: string;
  onMonthChange: (month: string) => void;
  onOpenBudget: () => void;
};

function DashboardCard({ children, title }: DashboardCardProps) {
  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        flex: 1,
        gap: 10,
        minWidth: 220,
        padding: 14,
      }}
    >
      <Text style={{ color: theme.pageTextLight, fontWeight: 600 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function AccountBalances({
  accounts,
  emptyMessage,
}: {
  accounts: HouseholdDashboardData['overview']['checkingAccounts'];
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  if (accounts.length === 0) {
    return <Text style={{ color: theme.pageTextLight }}>{emptyMessage}</Text>;
  }
  return (
    <View style={{ gap: 5 }}>
      {accounts.map(account => (
        <Button
          key={account.id}
          aria-label={t('View {{ name }} transactions', { name: account.name })}
          variant="bare"
          style={{ justifyContent: 'space-between', padding: 0 }}
          onPress={() => navigate(`/accounts/${account.id}`)}
        >
          <Text>{account.name}</Text>
          <FinancialText>{format(account.balance, 'financial')}</FinancialText>
        </Button>
      ))}
    </View>
  );
}

function CategoryTrend({
  trend,
  selectedMonth,
}: {
  selectedMonth: string;
  trend: HouseholdDashboardCategoryTrend;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();

  function showCategoryActivity() {
    void navigate('/accounts', {
      state: {
        categoryId: trend.categoryId,
        filterConditions: [
          {
            field: 'category',
            op: 'is',
            type: 'id',
            value: trend.categoryId,
          },
          {
            field: 'date',
            op: 'is',
            options: { month: true },
            type: 'date',
            value: selectedMonth,
          },
        ],
        goBack: true,
      },
    });
  }

  return (
    <View
      style={{
        borderTop: `1px solid ${theme.tableBorder}`,
        gap: 6,
        paddingTop: 8,
      }}
    >
      <Button
        aria-label={t('View {{ name }} activity', { name: trend.categoryName })}
        variant="bare"
        style={{ justifyContent: 'space-between', padding: 0 }}
        onPress={showCategoryActivity}
      >
        <Text style={{ fontWeight: 600 }}>{trend.categoryName}</Text>
        <FinancialText>{format(trend.total, 'financial')}</FinancialText>
      </Button>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {trend.months.map(item => (
          <View key={item.month} style={{ minWidth: 62 }} title={item.month}>
            <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
              {item.month.slice(5)}
            </Text>
            <FinancialText style={{ fontSize: 12 }}>
              {format(item.amount, 'financial')}
            </FinancialText>
          </View>
        ))}
      </View>
    </View>
  );
}

function FinancingSummary({
  dashboard,
}: {
  dashboard: HouseholdDashboardData;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {dashboard.financing.map(account => (
        <DashboardCard key={account.accountId} title={account.accountName}>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Observed current ledger balance</Trans>
          </Text>
          <Button
            aria-label={t('View {{ name }} transactions', {
              name: account.accountName,
            })}
            variant="bare"
            style={{ alignItems: 'flex-start', padding: 0 }}
            onPress={() => navigate(`/accounts/${account.accountId}`)}
          >
            <FinancialText style={{ fontSize: 20, fontWeight: 600 }}>
              {format(account.outstandingBalance, 'financial')}
            </FinancialText>
          </Button>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Verified manual allocation in the selected month</Trans>
          </Text>
          <View style={{ gap: 3 }}>
            <Text>
              <Trans>Principal</Trans>:{' '}
              {format(account.knownPrincipal, 'financial')}
            </Text>
            <Text>
              <Trans>Interest</Trans>:{' '}
              {format(account.knownInterest, 'financial')}
            </Text>
            <Text>
              <Trans>Insurance</Trans>:{' '}
              {format(account.knownInsurance, 'financial')}
            </Text>
          </View>
          {account.needsReviewCount > 0 && (
            <Text style={{ color: theme.errorText, fontSize: 13 }}>
              <Trans>
                {{ count: account.needsReviewCount }} allocation needs review.
              </Trans>
            </Text>
          )}
          <View style={{ alignItems: 'flex-start' }}>
            <Button onPress={() => navigate('/household#financing-management')}>
              <Trans>Manage financing allocations</Trans>
            </Button>
          </View>
        </DashboardCard>
      ))}
    </View>
  );
}

export function HouseholdDashboardPanel({
  dashboard,
  month,
  onMonthChange,
  onOpenBudget,
}: HouseholdDashboardPanelProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const { overview, monthly } = dashboard;
  const availableBudgetTitle =
    overview.availableBudgetLabel === 'available-to-budget'
      ? t('Available to budget')
      : t('Available savings');

  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: 600 }}>
            <Trans>Financial dashboard</Trans>
          </Text>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>
              Ledger balances are observed, monthly totals are calculated from
              Actual, and financing allocations are verified manual values.
            </Trans>
          </Text>
        </View>
        <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
          <Button
            aria-label={t('Previous month')}
            variant="bare"
            onPress={() => onMonthChange(monthUtils.prevMonth(month))}
          >
            ‹
          </Button>
          <View style={{ minWidth: 150 }}>
            <MonthInput
              id="actuynab-dashboard-month"
              value={month}
              onChange={onMonthChange}
            />
          </View>
          <Button
            aria-label={t('Next month')}
            variant="bare"
            onPress={() => onMonthChange(monthUtils.nextMonth(month))}
          >
            ›
          </Button>
          <Button
            variant="bare"
            onPress={() => onMonthChange(monthUtils.currentMonth())}
          >
            <Trans>Current</Trans>
          </Button>
        </View>
      </View>

      <DailyBudget
        dailyBudget={dashboard.dailyBudget}
        month={month}
        monthly={monthly}
        onOpenBudget={onOpenBudget}
      />

      <ImportReviewQueue reviews={dashboard.pendingReviews} />

      <View style={{ gap: 8 }}>
        <Text
          style={{ color: theme.pageTextLight, fontSize: 13, fontWeight: 600 }}
        >
          <Trans>Calculated monthly summary</Trans>
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <DashboardCard title={availableBudgetTitle}>
            <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
              {format(overview.availableBudget, 'financial')}
            </FinancialText>
            <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
              <Trans>
                Budget availability is not a bank-account balance and never
                includes off-budget liabilities.
              </Trans>
            </Text>
          </DashboardCard>
          <DashboardCard title={t('Income')}>
            <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
              {format(monthly.income, 'financial')}
            </FinancialText>
            <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
              <Trans>
                Categorized on-budget income for the selected month.
              </Trans>
            </Text>
          </DashboardCard>
          <DashboardCard title={t('Budgeted / actual spending')}>
            {monthly.hasBudgetedSpending ? (
              <>
                <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
                  {format(monthly.budgetedSpending, 'financial')} /{' '}
                  {format(monthly.actualSpending, 'financial')}
                </FinancialText>
                <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                  <Trans>
                    Budgeted amount compared with categorized spending.
                  </Trans>
                </Text>
              </>
            ) : (
              <>
                <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
                  {format(monthly.actualSpending, 'financial')}
                </FinancialText>
                <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                  <Trans>
                    Categorized spending; this month has no initialized budget
                    sheet to compare.
                  </Trans>
                </Text>
              </>
            )}
          </DashboardCard>
          <DashboardCard title={t('Transactions awaiting review')}>
            <Button
              aria-label={t('View transactions awaiting review')}
              variant="bare"
              style={{ alignItems: 'flex-start', padding: 0 }}
              onPress={() => navigate('/accounts')}
            >
              <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
                {overview.pendingImportReviews}
              </FinancialText>
            </Button>
            <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
              <Trans>Open review batches remain user-confirmed work.</Trans>
            </Text>
          </DashboardCard>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{ color: theme.pageTextLight, fontSize: 13, fontWeight: 600 }}
        >
          <Trans>Observed ledger balances</Trans>
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <DashboardCard title={t('Joint checking balances')}>
            <AccountBalances
              accounts={overview.checkingAccounts}
              emptyMessage={t('No checking accounts are configured.')}
            />
          </DashboardCard>
          <DashboardCard title={t('Credit-card balances')}>
            <AccountBalances
              accounts={overview.creditCardLiabilities}
              emptyMessage={t('No credit cards are configured.')}
            />
            <FinancialText style={{ fontWeight: 600 }}>
              {format(overview.totalCreditCardLiabilities, 'financial')}
            </FinancialText>
          </DashboardCard>
          <DashboardCard title={t('Upcoming scheduled transactions')}>
            {overview.upcomingBills.length === 0 ? (
              <Text style={{ color: theme.pageTextLight }}>
                <Trans>No upcoming scheduled transactions.</Trans>
              </Text>
            ) : (
              <View style={{ gap: 5 }}>
                {overview.upcomingBills.map(bill => (
                  <Button
                    key={bill.id}
                    aria-label={t('View scheduled transaction')}
                    variant="bare"
                    style={{ justifyContent: 'space-between', padding: 0 }}
                    onPress={() => navigate(`/schedules/${bill.id}`)}
                  >
                    <Text>{bill.payee || t('(No payee)')}</Text>
                    <FinancialText>
                      {bill.amount == null
                        ? t('Variable')
                        : format(bill.amount, 'financial')}
                    </FinancialText>
                    <Text style={{ color: theme.pageTextLight }}>
                      {bill.date}
                    </Text>
                  </Button>
                ))}
              </View>
            )}
          </DashboardCard>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{ color: theme.pageTextLight, fontSize: 13, fontWeight: 600 }}
        >
          <Trans>Category spending trends — last six months</Trans>
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <DashboardCard title={t('Top categorized spending')}>
            {dashboard.spendingTrends.length === 0 ? (
              <Text style={{ color: theme.pageTextLight }}>
                <Trans>No categorized spending in this period.</Trans>
              </Text>
            ) : (
              <View style={{ gap: 2 }}>
                {dashboard.spendingTrends.map(trend => (
                  <CategoryTrend
                    key={trend.categoryId}
                    selectedMonth={month}
                    trend={trend}
                  />
                ))}
              </View>
            )}
          </DashboardCard>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text
          style={{ color: theme.pageTextLight, fontSize: 13, fontWeight: 600 }}
        >
          <Trans>Observed financing and verified manual allocations</Trans>
        </Text>
        {dashboard.financing.length === 0 ? (
          <Text style={{ color: theme.pageTextLight }}>
            <Trans>No Home or Tesla financing accounts are configured.</Trans>
          </Text>
        ) : (
          <FinancingSummary dashboard={dashboard} />
        )}
      </View>
    </View>
  );
}
