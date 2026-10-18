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
import type {
  FinancingAccountOverview,
  FinancingBreakdownCandidates,
  FinancingPaymentDirection,
  FinancingTransactionCandidate,
  HouseholdFinancingOverview,
} from '@actual-app/core/server/transactions/actuynab-financing';
import { HOUSEHOLD_ACCOUNT_PRESETS } from '@actual-app/core/server/transactions/actuynab-household';
import type {
  HouseholdAccountKey,
  HouseholdProfile,
  HouseholdSetupAccount,
} from '@actual-app/core/server/transactions/actuynab-household';
import * as monthUtils from '@actual-app/core/shared/months';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Information } from '#components/alerts';
import { FinancialText } from '#components/FinancialText';
import { SectionLabel } from '#components/forms';
import { Page } from '#components/Page';
import { useAccounts } from '#hooks/useAccounts';
import { useFormat } from '#hooks/useFormat';
import { useLocalPref } from '#hooks/useLocalPref';
import { useNavigate } from '#hooks/useNavigate';

import { HouseholdDashboardPanel } from './HouseholdDashboard';

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

type FinancingDraft = {
  financingAccountId: string;
  insuranceAmount: string;
  insuranceTransactionId: string;
  interestAmount: string;
  paymentDirection: FinancingPaymentDirection;
  paymentTransactionId: string;
  principalAmount: string;
  principalTransactionId: string;
};

function emptyFinancingDraft(
  financing: HouseholdFinancingOverview,
): FinancingDraft {
  return {
    financingAccountId: financing.accounts[0]?.accountId ?? '',
    insuranceAmount: '0',
    insuranceTransactionId: '',
    interestAmount: '0',
    paymentDirection: 'payment',
    paymentTransactionId: '',
    principalAmount: '0',
    principalTransactionId: '',
  };
}

function transactionLabel(
  transaction: FinancingTransactionCandidate,
  format: ReturnType<typeof useFormat>,
  t: (value: string) => string,
) {
  const split = transaction.isSplit ? ` · ${t('Split')}` : '';
  const reconciled = transaction.reconciled ? ` · ${t('Reconciled')}` : '';
  return `${transaction.date} · ${transaction.accountName} · ${format(
    transaction.amount,
    'financial',
  )}${split}${reconciled}`;
}

function FinancingHistory({
  account,
  onDelete,
}: {
  account: FinancingAccountOverview;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <OverviewCard title={account.accountName}>
      <View style={{ gap: 5 }}>
        <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
          <Trans>Current ledger balance</Trans>
        </Text>
        <FinancialText style={{ fontSize: 20, fontWeight: 600 }}>
          {format(account.outstandingBalance, 'financial')}
        </FinancialText>
      </View>
      <View style={{ gap: 4 }}>
        <Text>
          <Trans>Known principal</Trans>:{' '}
          {format(account.knownPrincipal, 'financial')}
        </Text>
        <Text>
          <Trans>Known interest</Trans>:{' '}
          {format(account.knownInterest, 'financial')}
        </Text>
        <Text>
          <Trans>Known insurance</Trans>:{' '}
          {format(account.knownInsurance, 'financial')}
        </Text>
      </View>
      {account.needsReviewCount > 0 && (
        <Information style={{ color: theme.errorText }}>
          <Trans>
            {{ count: account.needsReviewCount }} saved financing allocation
            needs review because its supporting ledger movement changed.
          </Trans>
        </Information>
      )}
      {account.installments.length === 0 ? (
        <Text style={{ color: theme.pageTextLight }}>
          <Trans>No verified payment allocations yet.</Trans>
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {account.installments.map(installment => (
            <View
              key={installment.id}
              style={{
                borderTop: `1px solid ${theme.tableBorder}`,
                gap: 4,
                paddingTop: 8,
              }}
            >
              <View
                style={{
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontWeight: 600 }}>
                  {installment.paymentDate}
                </Text>
                <FinancialText>
                  {format(
                    installment.paymentDirection === 'payment'
                      ? -installment.paymentAmount
                      : installment.paymentAmount,
                    'financial',
                  )}
                </FinancialText>
              </View>
              <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
                <Trans>
                  Principal{' '}
                  {{
                    principal: format(installment.principalAmount, 'financial'),
                  }}
                  , interest{' '}
                  {{
                    interest: format(installment.interestAmount, 'financial'),
                  }}
                  , insurance{' '}
                  {{
                    insurance: format(installment.insuranceAmount, 'financial'),
                  }}
                </Trans>
                {installment.insuranceIsSeparate
                  ? ` (${t('separate charge')})`
                  : ''}
              </Text>
              {installment.status === 'needs-review' && (
                <Text style={{ color: theme.errorText, fontSize: 13 }}>
                  <Trans>
                    Supporting movement changed; review this allocation.
                  </Trans>
                </Text>
              )}
              <View style={{ alignItems: 'flex-start' }}>
                <ButtonWithLoading
                  isLoading={deletingId === installment.id}
                  onPress={() => remove(installment.id)}
                >
                  <Trans>Remove allocation</Trans>
                </ButtonWithLoading>
              </View>
            </View>
          ))}
        </View>
      )}
    </OverviewCard>
  );
}

function FinancingBreakdownForm({
  candidates,
  financing,
  onSaved,
}: {
  candidates: FinancingBreakdownCandidates;
  financing: HouseholdFinancingOverview;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [draft, setDraft] = useState<FinancingDraft>(() =>
    emptyFinancingDraft(financing),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const checkingTransactions = candidates.checkingTransactions.filter(
    transaction =>
      draft.paymentDirection === 'payment'
        ? transaction.amount < 0
        : transaction.amount > 0,
  );
  const financingTransactions = candidates.financingTransactions.filter(
    transaction => transaction.accountId === draft.financingAccountId,
  );

  function updateDraft(update: Partial<FinancingDraft>) {
    setDraft(current => ({ ...current, ...update }));
  }

  function parseAmount(label: string, value: string) {
    const amount = format.fromEdit(value);
    if (amount === null || amount < 0) {
      throw new Error(
        t('{{ label }} must be a non-negative amount.', { label }),
      );
    }
    return amount;
  }

  async function save() {
    setError(null);
    try {
      setIsSaving(true);
      await send('actuynab-financing-save', {
        financingAccountId: draft.financingAccountId,
        insuranceAmount: parseAmount(t('Insurance'), draft.insuranceAmount),
        insuranceTransactionId: draft.insuranceTransactionId || null,
        interestAmount: parseAmount(t('Interest'), draft.interestAmount),
        paymentDirection: draft.paymentDirection,
        paymentTransactionId: draft.paymentTransactionId,
        principalAmount: parseAmount(t('Principal'), draft.principalAmount),
        principalTransactionId: draft.principalTransactionId,
      });
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t('Unable to save the financing allocation.'),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View
      style={{
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        gap: 12,
        padding: 14,
      }}
    >
      <Text style={{ fontSize: 16, fontWeight: 600 }}>
        <Trans>Record a verified financing allocation</Trans>
      </Text>
      <Information>
        <Trans>
          Select existing ledger movements and enter only a breakdown you can
          verify. Saving this record does not create or edit a transaction,
          transfer, category, reconciliation, or amortization schedule.
        </Trans>
      </Information>
      {error && (
        <Information style={{ color: theme.errorText }}>{error}</Information>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <SectionLabel title={t('Financing account')} />
          <Select
            defaultLabel={t('Choose an account')}
            options={financing.accounts.map(account => [
              account.accountId,
              account.accountName,
            ])}
            value={draft.financingAccountId}
            onChange={financingAccountId =>
              updateDraft({ financingAccountId, principalTransactionId: '' })
            }
          />
        </View>
        <View style={{ flex: 1, minWidth: 220 }}>
          <SectionLabel title={t('Movement type')} />
          <Select
            options={[
              ['payment', t('Payment')],
              ['refund', t('Refund / correction')],
            ]}
            value={draft.paymentDirection}
            onChange={paymentDirection =>
              updateDraft({
                paymentDirection: paymentDirection as FinancingPaymentDirection,
                paymentTransactionId: '',
              })
            }
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 260 }}>
          <SectionLabel title={t('Checking payment movement')} />
          <Select
            defaultLabel={t('Choose an existing checking movement')}
            options={checkingTransactions.map(transaction => [
              transaction.id,
              transactionLabel(transaction, format, t),
            ])}
            value={draft.paymentTransactionId}
            onChange={paymentTransactionId =>
              updateDraft({ paymentTransactionId })
            }
          />
        </View>
        <View style={{ flex: 1, minWidth: 260 }}>
          <SectionLabel title={t('Financing principal movement')} />
          <Select
            defaultLabel={t('Choose the matching tracking-account movement')}
            options={financingTransactions.map(transaction => [
              transaction.id,
              transactionLabel(transaction, format, t),
            ])}
            value={draft.principalTransactionId}
            onChange={principalTransactionId =>
              updateDraft({ principalTransactionId })
            }
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <SectionLabel title={t('Principal')} />
          <Input
            value={draft.principalAmount}
            onChangeValue={principalAmount => updateDraft({ principalAmount })}
          />
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <SectionLabel title={t('Interest')} />
          <Input
            value={draft.interestAmount}
            onChangeValue={interestAmount => updateDraft({ interestAmount })}
          />
        </View>
        <View style={{ flex: 1, minWidth: 160 }}>
          <SectionLabel title={t('Insurance')} />
          <Input
            value={draft.insuranceAmount}
            onChangeValue={insuranceAmount => updateDraft({ insuranceAmount })}
          />
        </View>
        <View style={{ flex: 2, minWidth: 260 }}>
          <SectionLabel title={t('Separate insurance movement (optional)')} />
          <Select
            defaultLabel={t('Included in the selected payment')}
            options={candidates.checkingTransactions
              .filter(transaction => transaction.amount < 0)
              .map(transaction => [
                transaction.id,
                transactionLabel(transaction, format, t),
              ])}
            value={draft.insuranceTransactionId}
            onChange={insuranceTransactionId =>
              updateDraft({ insuranceTransactionId })
            }
          />
        </View>
      </View>
      <Text style={{ color: theme.pageTextLight, fontSize: 13 }}>
        <Trans>
          Principal must match the selected tracking-account movement.
          Principal, interest, and included insurance must equal the selected
          payment. When insurance is separate, select its own checking movement
          instead.
        </Trans>
      </Text>
      <View style={{ alignItems: 'flex-start' }}>
        <ButtonWithLoading
          isLoading={isSaving}
          variant="primary"
          onPress={save}
        >
          <Trans>Save verified allocation</Trans>
        </ButtonWithLoading>
      </View>
    </View>
  );
}

function FinancingManagementPanel({
  candidates,
  financing,
  onChanged,
}: {
  candidates: FinancingBreakdownCandidates;
  financing: HouseholdFinancingOverview;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    try {
      await send('actuynab-financing-delete', { id });
      await onChanged();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t('Unable to remove the financing allocation.'),
      );
    }
  }

  return (
    <View id="financing-management" style={{ gap: 12 }}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: 600 }}>
          <Trans>Financing management</Trans>
        </Text>
        <Text style={{ color: theme.pageTextLight }}>
          <Trans>
            Outstanding balances come from Actual tracking accounts. Known
            allocations below are reference metadata and are never added to
            spending or liabilities.
          </Trans>
        </Text>
      </View>
      {error && (
        <Information style={{ color: theme.errorText }}>{error}</Information>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {financing.accounts.map(account => (
          <FinancingHistory
            key={account.accountId}
            account={account}
            onDelete={remove}
          />
        ))}
      </View>
      <FinancingBreakdownForm
        candidates={candidates}
        financing={financing}
        onSaved={onChanged}
      />
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
          Choose an existing Actual account or enter a name for a new
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
  const navigate = useNavigate();
  const [dashboardMonthPreference, setDashboardMonthPreference] =
    useLocalPref('budget.startMonth');
  const dashboardMonth = dashboardMonthPreference || monthUtils.currentMonth();
  const profileQuery = useQuery({
    queryKey: ['actuynab-household-profile'],
    queryFn: () => send('actuynab-household-profile'),
  });
  const dashboardQuery = useQuery({
    queryKey: ['actuynab-household-dashboard', dashboardMonth],
    queryFn: () =>
      send('actuynab-household-dashboard', { month: dashboardMonth }),
  });
  const financingQuery = useQuery({
    queryKey: ['actuynab-financing-overview'],
    queryFn: () => send('actuynab-financing-overview'),
  });
  const financingCandidatesQuery = useQuery({
    queryKey: ['actuynab-financing-candidates'],
    queryFn: () => send('actuynab-financing-candidates'),
  });
  const [isEditing, setIsEditing] = useState(false);
  const profile = profileQuery.data ?? null;

  async function refresh() {
    await Promise.all([
      profileQuery.refetch(),
      dashboardQuery.refetch(),
      financingQuery.refetch(),
      financingCandidatesQuery.refetch(),
    ]);
  }

  function openBudget() {
    // Reuse Actual's existing local budget-month preference so the native
    // budget view opens on the month the household dashboard is showing.
    setDashboardMonthPreference(dashboardMonth);
    void navigate('/budget');
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
        {(profileQuery.isPending || dashboardQuery.isPending) && (
          <Text>
            <Trans>Loading household overview...</Trans>
          </Text>
        )}
        {(profileQuery.error || dashboardQuery.error) && (
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
        {profile && !isEditing && dashboardQuery.data && (
          <>
            <HouseholdDashboardPanel
              dashboard={dashboardQuery.data}
              month={dashboardMonth}
              onMonthChange={setDashboardMonthPreference}
              onOpenBudget={openBudget}
            />
            {financingQuery.data && financingCandidatesQuery.data && (
              <FinancingManagementPanel
                candidates={financingCandidatesQuery.data}
                financing={financingQuery.data}
                onChanged={refresh}
              />
            )}
          </>
        )}
      </View>
    </Page>
  );
}
