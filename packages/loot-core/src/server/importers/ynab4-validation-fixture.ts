import { safeZip } from '#server/util/zip';

import type * as YNAB4 from './ynab4-types';

const deviceId = 'actuynab-m2-device';
const root = 'ActuYNAB-M2~00000000.ynab4';

function account(
  entityId: string,
  accountName: string,
  accountType: string,
  onBudget: boolean,
  lastReconciledBalance = 0,
): YNAB4.Account {
  return {
    entityType: 'account',
    entityId,
    entityVersion: 'device-1',
    accountName,
    accountType,
    onBudget,
    hidden: false,
    lastEnteredCheckNumber: 0,
    lastReconciledBalance,
    sortableIndex: 0,
  };
}

function category(
  entityId: string,
  name: string,
  sortableIndex: number,
): YNAB4.SubCategory {
  return {
    entityType: 'subCategory',
    entityId,
    entityVersion: 'device-1',
    masterCategoryId: 'category-group-living',
    name,
    type: 'OUTFLOW',
    sortableIndex,
  };
}

function payee(
  entityId: string,
  name: string,
  targetAccountId?: string,
): YNAB4.Payee {
  return {
    entityType: 'payee',
    entityId,
    entityVersion: 'device-1',
    name,
    targetAccountId,
    autoFillAmount: 0,
    enabled: true,
  };
}

/** A complete, fictional YNAB 4 source budget used only by migration tests. */
export function createYnab4MigrationFixture(): YNAB4.YFull {
  return {
    accounts: [
      account(
        'account-checking',
        'M2 Everyday checking',
        'Checking',
        true,
        121250,
      ),
      account('account-savings', 'M2 Rainy-day savings', 'Savings', false),
      account('account-credit', 'M2 Credit card', 'CreditCard', true, -25000),
    ],
    masterCategories: [
      {
        entityType: 'masterCategory',
        entityId: 'category-group-living',
        entityVersion: 'device-1',
        name: 'M2 Living',
        note: 'Fictional category group note',
        type: 'OUTFLOW',
        expanded: true,
        deleteable: true,
        sortableIndex: 0,
        subCategories: [
          category('category-groceries', 'M2 Groceries', 0),
          category('category-household', 'M2 Household', 1),
        ],
      },
    ],
    payees: [
      payee('payee-employer', 'M2 Example Employer'),
      payee('payee-landlord', 'M2 Example Landlord'),
      payee('payee-market', 'M2 Example Market'),
      payee('payee-correction', 'M2 Historical correction'),
      payee('payee-transfer-savings', '', 'account-savings'),
      payee('payee-transfer-checking', '', 'account-checking'),
      payee('payee-card', 'M2 Example Card Merchant'),
      {
        ...payee('payee-rule', 'M2 Rule-only Payee'),
        renameConditions: [
          {
            entityType: 'renameCondition',
            entityId: 'payee-rule-1',
            entityVersion: 'device-1',
            parentPayeeId: 'payee-rule',
            operator: 'contains',
            operand: 'M2-EXAMPLE',
          },
        ],
      },
    ],
    transactions: [
      {
        entityType: 'transaction',
        entityId: 'transaction-salary',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'Category/__ImmediateIncome__',
        payeeId: 'payee-employer',
        amount: 2500,
        date: '2024-01-01',
        cleared: 'Reconciled',
        accepted: true,
        memo: 'Synthetic salary',
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-historic-correction',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'category-groceries',
        payeeId: 'payee-correction',
        amount: -5,
        date: '2024-01-02',
        cleared: 'Cleared',
        accepted: true,
        memo: 'Synthetic historical correction',
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-rent',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'category-household',
        payeeId: 'payee-landlord',
        amount: -1200,
        date: '2024-01-03',
        cleared: 'Reconciled',
        accepted: true,
        memo: 'Synthetic January rent',
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-split',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'Category/__Split__',
        payeeId: 'payee-market',
        amount: -82.5,
        date: '2024-02-01',
        cleared: 'Reconciled',
        accepted: true,
        memo: 'Synthetic split purchase',
        subTransactions: [
          {
            entityType: 'subTransaction',
            entityId: 'transaction-split-groceries',
            entityVersion: 'device-1',
            accountId: 'account-checking',
            categoryId: 'category-groceries',
            payeeId: 'payee-market',
            amount: -70,
            date: '2024-02-01',
            cleared: 'Uncleared',
            accepted: true,
          },
          {
            entityType: 'subTransaction',
            entityId: 'transaction-split-household',
            entityVersion: 'device-1',
            accountId: 'account-checking',
            categoryId: 'category-household',
            payeeId: 'payee-market',
            amount: -12.5,
            date: '2024-02-01',
            cleared: 'Uncleared',
            accepted: true,
          },
        ],
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-checking-to-savings',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'Category/__Split__',
        payeeId: 'payee-transfer-savings',
        amount: -500,
        date: '2024-02-28',
        cleared: 'Cleared',
        accepted: true,
        targetAccountId: 'account-savings',
        transferTransactionId: 'transaction-savings-in',
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-savings-in',
        entityVersion: 'device-1',
        accountId: 'account-savings',
        categoryId: 'Category/__Split__',
        payeeId: 'payee-transfer-checking',
        amount: 500,
        date: '2024-02-28',
        cleared: 'Cleared',
        accepted: true,
        targetAccountId: 'account-checking',
        transferTransactionId: 'transaction-checking-to-savings',
      },
      {
        entityType: 'transaction',
        entityId: 'transaction-card-charge',
        entityVersion: 'device-1',
        accountId: 'account-credit',
        categoryId: 'category-groceries',
        payeeId: 'payee-card',
        amount: -250,
        date: '2024-03-01',
        cleared: 'Reconciled',
        accepted: true,
        memo: 'Synthetic credit card charge',
      },
    ],
    monthlyBudgets: [
      {
        entityType: 'monthlyBudget',
        entityId: 'budget-january',
        entityVersion: 'device-1',
        month: '2024-01-01',
        note: 'Synthetic January note',
        monthlySubCategoryBudgets: [
          {
            entityType: 'monthlySubCategoryBudget',
            entityId: 'budget-january-groceries',
            entityVersion: 'device-1',
            parentMonthlyBudgetId: 'budget-january',
            categoryId: 'category-groceries',
            budgeted: 500,
            overspendingHandling: 'AffectsBuffer',
          },
          {
            entityType: 'monthlySubCategoryBudget',
            entityId: 'budget-january-household',
            entityVersion: 'device-1',
            parentMonthlyBudgetId: 'budget-january',
            categoryId: 'category-household',
            budgeted: 100,
            overspendingHandling: 'Confined',
          },
        ],
      },
      {
        entityType: 'monthlyBudget',
        entityId: 'budget-february',
        entityVersion: 'device-1',
        month: '2024-02-01',
        monthlySubCategoryBudgets: [
          {
            entityType: 'monthlySubCategoryBudget',
            entityId: 'budget-february-groceries',
            entityVersion: 'device-1',
            parentMonthlyBudgetId: 'budget-february',
            categoryId: 'category-groceries',
            budgeted: -30,
            overspendingHandling: 'Confined',
          },
        ],
      },
      {
        entityType: 'monthlyBudget',
        entityId: 'budget-march',
        entityVersion: 'device-1',
        month: '2024-03-01',
        monthlySubCategoryBudgets: [
          {
            entityType: 'monthlySubCategoryBudget',
            entityId: 'budget-march-groceries',
            entityVersion: 'device-1',
            parentMonthlyBudgetId: 'budget-march',
            categoryId: 'category-groceries',
            budgeted: 450,
            overspendingHandling: 'AffectsBuffer',
          },
        ],
      },
    ],
    scheduledTransactions: [
      {
        entityType: 'scheduledTransaction',
        entityId: 'schedule-monthly-broadband',
        entityVersion: 'device-1',
        accountId: 'account-checking',
        categoryId: 'category-household',
        payeeId: 'payee-landlord',
        amount: -45,
        date: '2024-03-28',
        memo: 'Synthetic scheduled expense',
        twiceAMonthStartDay: 0,
        cleared: 'Uncleared',
        frequency: 'Monthly',
        accepted: false,
      },
    ],
    fileMetaData: {
      entityType: 'fileMetaData',
      budgetDataVersion: '4.6',
      currentKnowledge: 'device-1',
    },
    budgetMetaData: {
      entityType: 'budgetMetaData',
      entityId: 'm2-budget',
      entityVersion: 'device-1',
      strictBudget: 'true',
      currencyLocale: 'en_US',
      budgetType: 'Personal',
      dateLocale: 'en_US',
    },
  };
}

/** Creates a disposable .ynab4-shaped ZIP; the source object is never written. */
export function createYnab4MigrationArchive(data: YNAB4.YFull): Buffer {
  return Buffer.from(
    safeZip({
      [`${root}/Budget.ymeta`]: Buffer.from(
        JSON.stringify({ relativeDataFolderName: 'data' }),
      ),
      [`${root}/data/devices/${deviceId}.ydevice`]: Buffer.from(
        JSON.stringify({
          hasFullKnowledge: true,
          deviceGUID: deviceId,
          shortDeviceId: 'M2',
          knowledge: 'device-1',
        }),
      ),
      [`${root}/data/${deviceId}/Budget.yfull`]: Buffer.from(
        JSON.stringify(data),
      ),
    }),
  );
}
