import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button, ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { HOUSEHOLD_ACCOUNT_PRESETS } from '@actual-app/core/server/transactions/actuynab-household';
import type {
  HouseholdAccountKey,
  HouseholdOverview,
  HouseholdOverviewAccount,
  HouseholdProfile,
  HouseholdSetupAccount,
} from '@actual-app/core/server/transactions/actuynab-household';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Information } from '#components/alerts';
import { FinancialText } from '#components/FinancialText';
import { SectionLabel } from '#components/forms';
import { Page } from '#components/Page';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';

type SetupDraft = Omit<HouseholdSetupAccount, 'transferDescriptionTokens'> & {
  transferDescriptionTokens: string;
};

function defaultSetupDraft(): SetupDraft[] {
  return HOUSEHOLD_ACCOUNT_PRESETS.map(preset => ({
    key: preset.key,
    name: preset.defaultName,
    accountId: null,
    transferDescriptionTokens:
      preset.defaultTransferDescriptionTokens.join(', '),
  }));
}

function draftFromProfile(profile: HouseholdProfile | null): SetupDraft[] {
  if (!profile) return defaultSetupDraft();
  return HOUSEHOLD_ACCOUNT_PRESETS.map(preset => {
    const configured = profile.accounts.find(
      account => account.key === preset.key,
    );
    return {
      key: preset.key,
      name: configured?.name ?? preset.defaultName,
      accountId: configured?.id ?? null,
      transferDescriptionTokens:
        configured?.transferDescriptionTokens?.join(', ') ??
        preset.defaultTransferDescriptionTokens.join(', '),
    };
  });
}

function roleLabel(key: HouseholdAccountKey, t: (value: string) => string) {
  switch (key) {
    case 'activo':
    case 'millenium':
      return t('Joint checking');
    case 'cc-activo-classic':
    case 'cc-millenium-gold':
    case 'cc-millenium-classic':
      return t('Credit card');
    case 'home':
      return t('Mortgage tracking');
    case 'tesla':
      return t('Vehicle financing tracking');
    default:
      return t('Household account');
  }
}

function AccountBalances({
  accounts,
  emptyMessage,
}: {
  accounts: HouseholdOverviewAccount[];
  emptyMessage: string;
}) {
  const format = useFormat();
  if (accounts.length === 0) {
    return <Text style={{ color: theme.pageTextLight }}>{emptyMessage}</Text>;
  }
  return (
    <View style={{ gap: 5 }}>
      {accounts.map(account => (
        <View
          key={account.id}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <Text>{account.name}</Text>
          <FinancialText>{format(account.balance, 'financial')}</FinancialText>
        </View>
      ))}
    </View>
  );
}

function OverviewCard({
  children,
  title,
}: {
  children: ReactNode;
  title: ReactNode;
}) {
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

function HouseholdOverviewPanel({ overview }: { overview: HouseholdOverview }) {
  const { t } = useTranslation();
  const format = useFormat();
  const availableBudgetTitle =
    overview.availableBudgetLabel === 'available-to-budget'
      ? t('Available to budget')
      : t('Available savings');

  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <OverviewCard title={availableBudgetTitle}>
          <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
            {format(overview.availableBudget, 'financial')}
          </FinancialText>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>
              This is budget availability, not a bank-account balance.
            </Trans>
          </Text>
        </OverviewCard>
        <OverviewCard title={t("This month's spending")}>
          <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
            {format(overview.monthlySpending, 'financial')}
          </FinancialText>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>
              Categorized on-budget activity, net of refunds. Transfers and
              credit-card payments are excluded.
            </Trans>
          </Text>
        </OverviewCard>
        <OverviewCard title={t('Pending import reviews')}>
          <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
            {overview.pendingImportReviews}
          </FinancialText>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>Transactions awaiting a review decision.</Trans>
          </Text>
        </OverviewCard>
        <OverviewCard title={t('Total liabilities')}>
          <FinancialText style={{ fontSize: 24, fontWeight: 600 }}>
            {format(overview.totalLiabilities, 'financial')}
          </FinancialText>
          <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
            <Trans>
              Sum of the absolute ledger balances for configured credit cards
              and financing accounts; it is not spendable cash.
            </Trans>
          </Text>
        </OverviewCard>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <OverviewCard title={t('Joint checking balances')}>
          <AccountBalances
            accounts={overview.checkingAccounts}
            emptyMessage={t('No checking accounts are configured.')}
          />
        </OverviewCard>
        <OverviewCard title={t('Credit-card liabilities')}>
          <AccountBalances
            accounts={overview.creditCardLiabilities}
            emptyMessage={t('No credit cards are configured.')}
          />
          <FinancialText style={{ fontWeight: 600 }}>
            {format(overview.totalCreditCardLiabilities, 'financial')}
          </FinancialText>
        </OverviewCard>
        <OverviewCard title={t('Off-budget financing')}>
          <AccountBalances
            accounts={overview.financingAccounts}
            emptyMessage={t('No financing accounts are configured.')}
          />
          <FinancialText style={{ fontWeight: 600 }}>
            {format(overview.totalFinancingLiabilities, 'financial')}
          </FinancialText>
        </OverviewCard>
        <OverviewCard title={t('Upcoming recurring bills')}>
          {overview.upcomingBills.length === 0 ? (
            <Text style={{ color: theme.pageTextLight }}>
              <Trans>No upcoming scheduled transactions.</Trans>
            </Text>
          ) : (
            <View style={{ gap: 5 }}>
              {overview.upcomingBills.map(bill => (
                <View
                  key={bill.id}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
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
                </View>
              ))}
            </View>
          )}
        </OverviewCard>
      </View>
    </View>
  );
}

function HouseholdSetup({
  profile,
  onConfigured,
}: {
  onConfigured: () => Promise<unknown>;
  profile: HouseholdProfile | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [drafts, setDrafts] = useState<SetupDraft[]>(() =>
    draftFromProfile(profile),
  );
  const [applyCategoryTemplate, setApplyCategoryTemplate] = useState(
    profile?.categoryTemplateApplied ?? false,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function updateDraft(key: HouseholdAccountKey, update: Partial<SetupDraft>) {
    setDrafts(current =>
      current.map(draft =>
        draft.key === key ? { ...draft, ...update } : draft,
      ),
    );
  }

  async function applySetup() {
    setError(null);
    try {
      setIsSaving(true);
      await send('actuynab-household-configure', {
        accounts: drafts.map(draft => ({
          accountId: draft.accountId || null,
          key: draft.key,
          name: draft.name,
          transferDescriptionTokens: draft.transferDescriptionTokens
            .split(',')
            .map(token => token.trim())
            .filter(Boolean),
        })),
        applyCategoryTemplate,
      });
      await queryClient.invalidateQueries();
      await onConfigured();
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? setupError.message
          : t('Unable to save the household setup.'),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={{ gap: 16, maxWidth: 1000 }}>
      <Information>
        <Trans>
          Choose an existing ActuYNAB account or enter a name for a new
          zero-balance account. Reapplying this setup adopts the saved role
          mapping and does not change transactions, balances, or account types.
        </Trans>
      </Information>
      <Information>
        <Trans>
          Home and Tesla are off-budget tracking accounts. This workflow does
          not create an amortization schedule or infer principal and interest.
        </Trans>
      </Information>
      {error && (
        <Information style={{ color: theme.errorText }}>{error}</Information>
      )}
      <View style={{ gap: 12 }}>
        {drafts.map(draft => {
          const preset = HOUSEHOLD_ACCOUNT_PRESETS.find(
            item => item.key === draft.key,
          );
          if (!preset) return null;
          const compatibleAccounts = accounts.filter(
            account => account.offbudget === Number(!preset.onBudget),
          );
          return (
            <View
              key={draft.key}
              style={{
                border: `1px solid ${theme.tableBorder}`,
                borderRadius: 6,
                gap: 10,
                padding: 12,
              }}
            >
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ fontWeight: 600 }}>
                  {draft.name || preset.defaultName}
                </Text>
                <Text style={{ color: theme.pageTextLight }}>
                  {roleLabel(draft.key, t)} -{' '}
                  {preset.onBudget ? t('On budget') : t('Off budget')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 180 }}>
                  <SectionLabel title={t('Account')} />
                  <Select
                    defaultLabel={t('Create or adopt by name')}
                    options={compatibleAccounts.map(
                      account => [account.id, account.name] as const,
                    )}
                    value={draft.accountId ?? ''}
                    onChange={accountId =>
                      updateDraft(draft.key, {
                        accountId: accountId || null,
                        name:
                          compatibleAccounts.find(
                            account => account.id === accountId,
                          )?.name ?? draft.name,
                      })
                    }
                  />
                </View>
                <View style={{ flex: 1, minWidth: 180 }}>
                  <SectionLabel title={t('Account name')} />
                  <Input
                    value={draft.name}
                    onChangeValue={name => updateDraft(draft.key, { name })}
                  />
                </View>
                <View style={{ flex: 2, minWidth: 240 }}>
                  <SectionLabel title={t('Transfer description phrases')} />
                  <Input
                    value={draft.transferDescriptionTokens}
                    onChangeValue={transferDescriptionTokens =>
                      updateDraft(draft.key, { transferDescriptionTokens })
                    }
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>
      <label>
        <input
          checked={applyCategoryTemplate}
          type="checkbox"
          onChange={event => setApplyCategoryTemplate(event.target.checked)}
        />{' '}
        <Trans>
          Add the optional household category template without duplicating
          existing same-named groups or categories.
        </Trans>
      </label>
      <View style={{ alignItems: 'flex-start' }}>
        <ButtonWithLoading
          isLoading={isSaving}
          variant="primary"
          onPress={applySetup}
        >
          <Trans>Save household setup</Trans>
        </ButtonWithLoading>
      </View>
    </View>
  );
}

export function HouseholdPage() {
  const profileQuery = useQuery({
    queryKey: ['actuynab-household-profile'],
    queryFn: () => send('actuynab-household-profile'),
  });
  const overviewQuery = useQuery({
    queryKey: ['actuynab-household-overview'],
    queryFn: () => send('actuynab-household-overview'),
  });
  const [isEditing, setIsEditing] = useState(false);
  const profile = profileQuery.data ?? null;
  const overview = overviewQuery.data;

  async function refresh() {
    await Promise.all([profileQuery.refetch(), overviewQuery.refetch()]);
  }

  return (
    <Page
      header={
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            margin: '0 20px',
          }}
        >
          <Text style={{ fontSize: 25, fontWeight: 500 }}>
            <Trans>Household</Trans>
          </Text>
          {profile && !isEditing && (
            <Button onPress={() => setIsEditing(true)}>
              <Trans>Edit setup</Trans>
            </Button>
          )}
        </View>
      }
      padding={20}
    >
      <View style={{ gap: 16, paddingBottom: 20 }}>
        {(profileQuery.isPending || overviewQuery.isPending) && (
          <Text>
            <Trans>Loading household overview...</Trans>
          </Text>
        )}
        {(profileQuery.error || overviewQuery.error) && (
          <Information style={{ color: theme.errorText }}>
            <Trans>Unable to load the household configuration.</Trans>
          </Information>
        )}
        {!profileQuery.isPending && !profile && (
          <>
            <Text style={{ fontSize: 18, fontWeight: 600 }}>
              <Trans>Set up your shared household budget</Trans>
            </Text>
            <HouseholdSetup
              profile={null}
              onConfigured={async () => {
                await refresh();
                setIsEditing(false);
              }}
            />
          </>
        )}
        {profile && isEditing && (
          <HouseholdSetup
            profile={profile}
            onConfigured={async () => {
              await refresh();
              setIsEditing(false);
            }}
          />
        )}
        {profile && !isEditing && overview && (
          <HouseholdOverviewPanel overview={overview} />
        )}
      </View>
    </Page>
  );
}
