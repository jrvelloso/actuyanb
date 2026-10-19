import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import {
  SvgCheveronDown,
  SvgCheveronRight,
} from '@actual-app/components/icons/v1';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { AccountEntity } from '@actual-app/core/types/models';

import { useMoveAccountMutation } from '#accounts';
import { isAccountFailedSync } from '#accounts/syncStatus';
import { CellValue } from '#components/spreadsheet/CellValue';
import { useAccounts } from '#hooks/useAccounts';
import { useClosedAccounts } from '#hooks/useClosedAccounts';
import { useLocalPref } from '#hooks/useLocalPref';
import { useOffBudgetAccounts } from '#hooks/useOffBudgetAccounts';
import { useOnBudgetAccounts } from '#hooks/useOnBudgetAccounts';
import { useUpdatedAccounts } from '#hooks/useUpdatedAccounts';
import { useSelector } from '#redux';
import type { Binding } from '#spreadsheet';
import * as bindings from '#spreadsheet/bindings';

import { Account } from './Account';
import { SecondaryItem } from './SecondaryItem';

const fontWeight = 600;

type AccountGroupProps = {
  balanceTestId: string;
  children: ReactNode;
  isOpen: boolean;
  label: string;
  onToggle: () => void;
  query: Binding<
    'account',
    'offbudget-accounts-balance' | 'onbudget-accounts-balance'
  >;
};

function AccountGroup({
  balanceTestId,
  children,
  isOpen,
  label,
  onToggle,
  query,
}: AccountGroupProps) {
  const { t } = useTranslation();
  const Chevron = isOpen ? SvgCheveronDown : SvgCheveronRight;

  return (
    <View style={{ marginTop: 13 }}>
      <View
        style={{
          alignItems: 'center',
          flexDirection: 'row',
          minHeight: 26,
          paddingRight: 10,
        }}
      >
        <Button
          aria-expanded={isOpen}
          aria-label={
            isOpen
              ? t('Collapse {{ section }}', { section: label })
              : t('Expand {{ section }}', { section: label })
          }
          variant="bare"
          onPress={onToggle}
          style={{ flex: 1, justifyContent: 'flex-start', padding: '4px 10px' }}
        >
          <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5 }}>
            <Chevron width={12} height={12} />
            <Text style={{ fontSize: 13, fontWeight }}>{label}</Text>
          </View>
        </Button>
        <View data-testid={balanceTestId}>
          <CellValue binding={query} type="financial" />
        </View>
      </View>
      {isOpen && children}
    </View>
  );
}

export function Accounts() {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [isBudgetAccountsOpen, setBudgetAccountsOpen] = useState(true);
  const [isOffBudgetAccountsOpen, setOffBudgetAccountsOpen] = useState(true);
  const { data: accounts = [] } = useAccounts();
  const updatedAccounts = useUpdatedAccounts();
  const { data: offbudgetAccounts = [] } = useOffBudgetAccounts();
  const { data: onBudgetAccounts = [] } = useOnBudgetAccounts();
  const { data: closedAccounts = [] } = useClosedAccounts();
  const syncingAccountIds = useSelector(state => state.account.accountsSyncing);

  const getAccountPath = (account: AccountEntity) => `/accounts/${account.id}`;

  const [showClosedAccounts, setShowClosedAccountsPref] = useLocalPref(
    'ui.showClosedAccounts',
  );

  function onDragChange(drag: { state: string }) {
    setIsDragging(drag.state === 'start');
  }

  const moveAccount = useMoveAccountMutation();

  const makeDropPadding = (i: number) => {
    if (i === 0) {
      return {
        paddingTop: isDragging ? 15 : 0,
        marginTop: isDragging ? -15 : 0,
      };
    }
    return undefined;
  };

  async function onReorder(
    id: string,
    dropPos: 'top' | 'bottom' | null,
    targetId: string,
  ) {
    let targetIdToMove: string | null = targetId;
    if (dropPos === 'bottom') {
      const idx = accounts.findIndex(a => a.id === targetId) + 1;
      targetIdToMove = idx < accounts.length ? accounts[idx].id : null;
    }

    moveAccount.mutate({ id, targetId: targetIdToMove });
  }

  const onToggleClosedAccounts = () => {
    setShowClosedAccountsPref(!showClosedAccounts);
  };

  return (
    <View
      style={{
        flexGrow: 1,
        '@media screen and (max-height: 480px)': {
          minHeight: 'auto',
        },
      }}
    >
      <View
        style={{
          height: 1,
          backgroundColor: theme.sidebarItemBackgroundHover,
          marginTop: 15,
          flexShrink: 0,
        }}
      />

      <View style={{ overflow: 'auto' }}>
        <Account
          name={t('All Accounts')}
          to="/accounts"
          query={bindings.allAccountBalance()}
          style={{ fontWeight, marginTop: 15 }}
          isExactPathMatch
          balanceTestId="sidebar-all-accounts-balance"
        />

        {onBudgetAccounts.length > 0 && (
          <AccountGroup
            balanceTestId="sidebar-on-budget-balance"
            isOpen={isBudgetAccountsOpen}
            label={t('Budget Accounts')}
            onToggle={() => setBudgetAccountsOpen(isOpen => !isOpen)}
            query={bindings.onBudgetAccountBalance()}
          >
            {onBudgetAccounts.map((account, i) => (
              <Account
                key={account.id}
                name={account.name}
                account={account}
                connected={!!account.bank}
                pending={syncingAccountIds.includes(account.id)}
                failed={isAccountFailedSync(account)}
                updated={updatedAccounts.includes(account.id)}
                to={getAccountPath(account)}
                query={bindings.accountBalance(account.id)}
                onDragChange={onDragChange}
                onDrop={onReorder}
                outerStyle={makeDropPadding(i)}
              />
            ))}
          </AccountGroup>
        )}

        {offbudgetAccounts.length > 0 && (
          <AccountGroup
            balanceTestId="sidebar-off-budget-balance"
            isOpen={isOffBudgetAccountsOpen}
            label={t('Off-Budget Accounts')}
            onToggle={() => setOffBudgetAccountsOpen(isOpen => !isOpen)}
            query={bindings.offBudgetAccountBalance()}
          >
            {offbudgetAccounts.map((account, i) => (
              <Account
                key={account.id}
                name={account.name}
                account={account}
                connected={!!account.bank}
                pending={syncingAccountIds.includes(account.id)}
                failed={isAccountFailedSync(account)}
                updated={updatedAccounts.includes(account.id)}
                to={getAccountPath(account)}
                query={bindings.accountBalance(account.id)}
                onDragChange={onDragChange}
                onDrop={onReorder}
                outerStyle={makeDropPadding(i)}
              />
            ))}
          </AccountGroup>
        )}

        {closedAccounts.length > 0 && (
          <SecondaryItem
            style={{ marginTop: 15 }}
            title={
              showClosedAccounts
                ? t('Closed accounts')
                : t('Closed accounts...')
            }
            onClick={onToggleClosedAccounts}
            bold
          />
        )}

        {showClosedAccounts &&
          closedAccounts.map(account => (
            <Account
              key={account.id}
              name={account.name}
              account={account}
              to={getAccountPath(account)}
              query={bindings.accountBalance(account.id)}
              onDragChange={onDragChange}
              onDrop={onReorder}
            />
          ))}
      </View>
    </View>
  );
}
