import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { HouseholdDashboard } from '@actual-app/core/server/transactions/actuynab-dashboard';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { pushModal } from '#modals/modalsSlice';
import { useDispatch } from '#redux';

type DailyBudgetProps = {
  dailyBudget: HouseholdDashboard['dailyBudget'];
  month: string;
  monthly: HouseholdDashboard['monthly'];
  onOpenBudget: () => void;
};

type CategoryRowProps = {
  category: HouseholdDashboard['dailyBudget']['categories'][number];
  month: string;
};

type ImportReviewQueueProps = {
  reviews: HouseholdDashboard['pendingReviews'];
};

function showCategoryActivity(
  navigate: ReturnType<typeof useNavigate>,
  categoryId: string,
  month: string,
) {
  void navigate('/accounts', {
    state: {
      categoryId,
      filterConditions: [
        {
          field: 'category',
          op: 'is',
          type: 'id',
          value: categoryId,
        },
        {
          field: 'date',
          op: 'is',
          options: { month: true },
          type: 'date',
          value: month,
        },
      ],
      goBack: true,
    },
  });
}

function CategoryRow({ category, month }: CategoryRowProps) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const isOverspent = category.balance < 0;

  return (
    <View
      style={{
        borderTop: `1px solid ${theme.tableBorder}`,
        gap: 6,
        paddingTop: 8,
      }}
    >
      <Button
        aria-label={t('View {{ name }} activity', {
          name: category.categoryName,
        })}
        variant="bare"
        style={{ alignItems: 'flex-start', padding: 0 }}
        onPress={() =>
          showCategoryActivity(navigate, category.categoryId, month)
        }
      >
        <Text style={{ fontWeight: 600 }}>{category.categoryName}</Text>
        <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
          {category.groupName}
        </Text>
      </Button>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Text style={{ fontSize: 13 }}>
          <Trans>Budgeted</Trans>: {format(category.budgeted, 'financial')}
        </Text>
        <Text style={{ fontSize: 13 }}>
          <Trans>Spent</Trans>: {format(category.spent, 'financial')}
        </Text>
        <Text
          style={{
            color: isOverspent ? theme.errorText : theme.pageText,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {isOverspent ? <Trans>Overspent</Trans> : <Trans>Remaining</Trans>}:{' '}
          <FinancialText>{format(category.balance, 'financial')}</FinancialText>
        </Text>
      </View>
      {category.carriesOver && (
        <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
          <Trans>
            This category uses Actual&apos;s native carryover setting.
          </Trans>
        </Text>
      )}
    </View>
  );
}

export function DailyBudget({
  dailyBudget,
  month,
  monthly,
  onOpenBudget,
}: DailyBudgetProps) {
  const format = useFormat();
  const overspentCategories = dailyBudget.categories.filter(
    category => category.balance < 0,
  );
  const visibleCategories = dailyBudget.categories
    .filter(
      category =>
        category.budgeted !== 0 ||
        category.spent !== 0 ||
        category.balance !== 0,
    )
    .sort(
      (left, right) =>
        Number(right.balance < 0) - Number(left.balance < 0) ||
        left.balance - right.balance,
    )
    .slice(0, 6);

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text style={{ fontSize: 18, fontWeight: 600 }}>
            <Trans>Daily budget</Trans>
          </Text>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>
              Native category balances for the selected month, including
              carryover where Actual applies it.
            </Trans>
          </Text>
        </View>
        <Button onPress={onOpenBudget}>
          <Trans>Open full budget</Trans>
        </Button>
      </View>
      {!dailyBudget.hasBudgetData ? (
        <Text style={{ color: theme.pageTextLight }}>
          <Trans>
            This month has no initialized budget sheet. Open Budget to create or
            review it.
          </Trans>
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <View
            style={{
              border: `1px solid ${theme.tableBorder}`,
              borderRadius: 6,
              flex: 1,
              gap: 8,
              minWidth: 220,
              padding: 14,
            }}
          >
            <Text style={{ color: theme.pageTextLight, fontWeight: 600 }}>
              <Trans>Monthly budget status</Trans>
            </Text>
            <Text>
              <Trans>Budgeted</Trans>:{' '}
              <FinancialText>
                {format(monthly.budgetedSpending, 'financial')}
              </FinancialText>
            </Text>
            <Text>
              <Trans>Spent</Trans>:{' '}
              <FinancialText>
                {format(monthly.actualSpending, 'financial')}
              </FinancialText>
            </Text>
            <Text style={{ fontWeight: 600 }}>
              <Trans>Remaining category balances</Trans>:{' '}
              <FinancialText>
                {format(dailyBudget.remaining, 'financial')}
              </FinancialText>
            </Text>
            <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
              <Trans>
                These are Actual&apos;s budget-sheet values, not account
                balances.
              </Trans>
            </Text>
          </View>
          <View
            style={{
              border: `1px solid ${theme.tableBorder}`,
              borderRadius: 6,
              flex: 2,
              gap: 8,
              minWidth: 280,
              padding: 14,
            }}
          >
            <Text style={{ color: theme.pageTextLight, fontWeight: 600 }}>
              {overspentCategories.length > 0 ? (
                <Trans>Categories needing attention</Trans>
              ) : (
                <Trans>Category balances</Trans>
              )}
            </Text>
            {overspentCategories.length > 0 && (
              <Text style={{ color: theme.errorText, fontSize: 13 }}>
                <Trans>
                  {{ count: overspentCategories.length }} category needs
                  attention before the month closes.
                </Trans>
              </Text>
            )}
            {visibleCategories.length === 0 ? (
              <Text style={{ color: theme.pageTextLight }}>
                <Trans>
                  No category activity or budgeted amounts this month.
                </Trans>
              </Text>
            ) : (
              <View style={{ gap: 2 }}>
                {visibleCategories.map(category => (
                  <CategoryRow
                    key={category.categoryId}
                    category={category}
                    month={month}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

export function ImportReviewQueue({ reviews }: ImportReviewQueueProps) {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  function openReview(review: HouseholdDashboard['pendingReviews'][number]) {
    dispatch(
      pushModal({
        modal: {
          name: 'actuynab-import-review',
          options: {
            accountId: review.accountId,
            batchId: review.batchId,
          },
        },
      }),
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{ color: theme.pageTextLight, fontSize: 13, fontWeight: 600 }}
      >
        <Trans>Review imported transactions</Trans>
      </Text>
      {reviews.length === 0 ? (
        <Text style={{ color: theme.pageTextLight }}>
          <Trans>No imported transactions are awaiting review.</Trans>
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {reviews.map(review => (
            <View
              key={review.batchId}
              style={{
                border: `1px solid ${theme.tableBorder}`,
                borderRadius: 6,
                flex: 1,
                gap: 8,
                minWidth: 260,
                padding: 14,
              }}
            >
              <Text style={{ fontWeight: 600 }}>{review.accountName}</Text>
              <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                <Trans>Source</Trans>: {review.sourceBank} (
                {review.sourceFormat})
              </Text>
              <Text style={{ fontSize: 13 }}>
                <Trans>
                  {{ count: review.itemCount }} transaction in this review.
                </Trans>
              </Text>
              {review.manualReviewCount > 0 && (
                <Text style={{ color: theme.warningText, fontSize: 13 }}>
                  <Trans>
                    {{ count: review.manualReviewCount }} item requires manual
                    attention.
                  </Trans>
                </Text>
              )}
              {review.transferCount > 0 && (
                <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                  <Trans>
                    {{ count: review.transferCount }} transfer is protected for
                    review.
                  </Trans>
                </Text>
              )}
              {review.creditCardPaymentCount > 0 && (
                <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                  <Trans>
                    {{ count: review.creditCardPaymentCount }} credit-card
                    payment is protected from new spending.
                  </Trans>
                </Text>
              )}
              <View
                style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}
              >
                <Button onPress={() => openReview(review)}>
                  <Trans>Open review</Trans>
                </Button>
                <Button
                  variant="bare"
                  onPress={() => navigate(`/accounts/${review.accountId}`)}
                >
                  <Trans>View account</Trans>
                </Button>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
