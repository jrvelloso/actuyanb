import { createHash } from 'node:crypto';

import * as db from '#server/db';
import { batchMessages } from '#server/sync';

import type { HouseholdAccountRole } from './actuynab-classification';
import { loadHouseholdProfile } from './actuynab-household';
import type { HouseholdConfiguredAccount } from './actuynab-household';

type FinancingRole = Extract<
  HouseholdAccountRole,
  'mortgage' | 'vehicle-financing'
>;

type StoredInstallment = {
  account_id: string;
  created_at: string;
  id: string;
  insurance_amount: number;
  insurance_is_separate: number;
  insurance_transaction_id: string | null;
  interest_amount: number;
  payment_amount: number;
  payment_date: string;
  payment_direction: FinancingPaymentDirection;
  payment_transaction_id: string;
  principal_amount: number;
  principal_transaction_id: string;
};

type LedgerTransaction = {
  account: string;
  amount: number;
  date: number;
  id: string;
  is_child: number;
  is_parent: number;
  reconciled: number;
};

export type FinancingPaymentDirection = 'payment' | 'refund';

export type FinancingTransactionCandidate = {
  accountId: string;
  accountName: string;
  amount: number;
  date: string;
  id: string;
  isSplit: boolean;
  reconciled: boolean;
};

export type FinancingInstallment = {
  accountId: string;
  createdAt: string;
  id: string;
  insuranceAmount: number;
  insuranceIsSeparate: boolean;
  insuranceTransactionId: string | null;
  interestAmount: number;
  paymentAmount: number;
  paymentDate: string;
  paymentDirection: FinancingPaymentDirection;
  paymentTransactionId: string;
  principalAmount: number;
  principalTransactionId: string;
  status: 'verified' | 'needs-review';
};

export type FinancingAccountOverview = {
  accountId: string;
  accountName: string;
  accountRole: FinancingRole;
  installments: FinancingInstallment[];
  knownInsurance: number;
  knownInterest: number;
  knownPrincipal: number;
  needsReviewCount: number;
  outstandingBalance: number;
};

export type HouseholdFinancingOverview = {
  accounts: FinancingAccountOverview[];
  isConfigured: boolean;
};

export type FinancingBreakdownCandidates = {
  checkingTransactions: FinancingTransactionCandidate[];
  financingTransactions: FinancingTransactionCandidate[];
};

export type SaveFinancingBreakdownInput = {
  financingAccountId: string;
  insuranceAmount: number;
  insuranceTransactionId?: string | null;
  interestAmount: number;
  paymentDirection: FinancingPaymentDirection;
  paymentTransactionId: string;
  principalAmount: number;
  principalTransactionId: string;
};

function identifierFor(...parts: string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function isFinancingRole(role: HouseholdAccountRole): role is FinancingRole {
  return role === 'mortgage' || role === 'vehicle-financing';
}

function isFinancingAccount(
  account: HouseholdConfiguredAccount,
): account is HouseholdConfiguredAccount & { role: FinancingRole } {
  return isFinancingRole(account.role);
}

function paymentMultiplier(direction: FinancingPaymentDirection) {
  return direction === 'payment' ? 1 : -1;
}

function amountIsValid(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function toInstallment(
  row: StoredInstallment,
  status: FinancingInstallment['status'],
): FinancingInstallment {
  return {
    accountId: row.account_id,
    createdAt: row.created_at,
    id: row.id,
    insuranceAmount: row.insurance_amount,
    insuranceIsSeparate: Boolean(row.insurance_is_separate),
    insuranceTransactionId: row.insurance_transaction_id,
    interestAmount: row.interest_amount,
    paymentAmount: row.payment_amount,
    paymentDate: row.payment_date,
    paymentDirection: row.payment_direction,
    paymentTransactionId: row.payment_transaction_id,
    principalAmount: row.principal_amount,
    principalTransactionId: row.principal_transaction_id,
    status,
  };
}

async function ledgerTransactions(
  ids: readonly string[],
): Promise<Map<string, LedgerTransaction>> {
  const distinctIds = [...new Set(ids.filter(Boolean))];
  if (distinctIds.length === 0) return new Map();
  const rows = await db.all<LedgerTransaction>(
    `SELECT id, account, amount, date, is_parent, is_child, reconciled
     FROM v_transactions
     WHERE id IN (${distinctIds.map(() => '?').join(', ')})
       AND tombstone = 0`,
    distinctIds,
  );
  return new Map(rows.map(row => [row.id, row]));
}

function installmentStatus(
  row: StoredInstallment,
  transactions: ReadonlyMap<string, LedgerTransaction>,
  checkingAccountIds: ReadonlySet<string>,
): FinancingInstallment['status'] {
  const payment = transactions.get(row.payment_transaction_id);
  const principal = transactions.get(row.principal_transaction_id);
  const insurance = row.insurance_transaction_id
    ? transactions.get(row.insurance_transaction_id)
    : undefined;
  if (
    !payment ||
    !principal ||
    Math.abs(payment.amount) !== row.payment_amount ||
    Math.abs(principal.amount) !== row.principal_amount ||
    db.fromDateRepr(payment.date) !== row.payment_date ||
    (row.payment_direction === 'payment' && payment.amount >= 0) ||
    (row.payment_direction === 'refund' && payment.amount <= 0) ||
    !checkingAccountIds.has(payment.account) ||
    principal.account !== row.account_id ||
    Boolean(row.insurance_transaction_id) !==
      Boolean(row.insurance_is_separate) ||
    (row.insurance_transaction_id &&
      (!insurance ||
        !checkingAccountIds.has(insurance.account) ||
        Math.abs(insurance.amount) !== row.insurance_amount))
  ) {
    return 'needs-review';
  }
  return 'verified';
}

async function storedInstallments(): Promise<StoredInstallment[]> {
  return db.all<StoredInstallment>(
    `SELECT id, account_id, payment_transaction_id, principal_transaction_id,
            insurance_transaction_id, payment_amount, principal_amount,
            interest_amount, insurance_amount, payment_direction,
            insurance_is_separate, payment_date, created_at
     FROM actuynab_financing_installments
     WHERE tombstone = 0
     ORDER BY payment_date DESC, created_at DESC`,
  );
}

export async function getHouseholdFinancingOverview(): Promise<HouseholdFinancingOverview> {
  const profile = await loadHouseholdProfile();
  if (!profile) return { accounts: [], isConfigured: false };

  const financingAccounts = profile.accounts.filter(isFinancingAccount);
  const checkingAccountIds = new Set(
    profile.accounts
      .filter(account => account.role === 'joint-checking')
      .map(account => account.id),
  );
  const rows = await storedInstallments();
  const transactions = await ledgerTransactions(
    rows.flatMap(row => [
      row.payment_transaction_id,
      row.principal_transaction_id,
      ...(row.insurance_transaction_id ? [row.insurance_transaction_id] : []),
    ]),
  );
  const balances = await db.all<{ account: string; balance: number }>(
    `SELECT account, COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account IN (${financingAccounts.map(() => '?').join(', ') || "''"})
       AND is_parent = 0
     GROUP BY account`,
    financingAccounts.map(account => account.id),
  );
  const balancesByAccount = new Map(
    balances.map(row => [row.account, row.balance]),
  );

  return {
    isConfigured: true,
    accounts: financingAccounts.map(account => {
      const installments = rows
        .filter(row => row.account_id === account.id)
        .map(row =>
          toInstallment(
            row,
            installmentStatus(row, transactions, checkingAccountIds),
          ),
        );
      const verified = installments.filter(
        installment => installment.status === 'verified',
      );
      const netAmount = (
        amount: (installment: FinancingInstallment) => number,
      ) =>
        verified.reduce(
          (total, installment) =>
            total +
            paymentMultiplier(installment.paymentDirection) *
              amount(installment),
          0,
        );
      return {
        accountId: account.id,
        accountName: account.name,
        accountRole: account.role,
        installments,
        knownInsurance: netAmount(item => item.insuranceAmount),
        knownInterest: netAmount(item => item.interestAmount),
        knownPrincipal: netAmount(item => item.principalAmount),
        needsReviewCount: installments.filter(
          installment => installment.status === 'needs-review',
        ).length,
        outstandingBalance: balancesByAccount.get(account.id) ?? 0,
      };
    }),
  };
}

function toCandidate(
  row: LedgerTransaction,
  accountName: string,
): FinancingTransactionCandidate {
  return {
    accountId: row.account,
    accountName,
    amount: row.amount,
    date: db.fromDateRepr(row.date),
    id: row.id,
    isSplit: Boolean(row.is_parent || row.is_child),
    reconciled: Boolean(row.reconciled),
  };
}

async function candidatesForAccounts(
  accounts: ReadonlyMap<string, string>,
): Promise<FinancingTransactionCandidate[]> {
  const ids = [...accounts.keys()];
  if (ids.length === 0) return [];
  const rows = await db.all<LedgerTransaction>(
    `SELECT id, account, amount, date, is_parent, is_child, reconciled
     FROM v_transactions
     WHERE account IN (${ids.map(() => '?').join(', ')})
       AND tombstone = 0
       AND amount != 0
     ORDER BY date DESC, id DESC
     LIMIT 250`,
    ids,
  );
  return rows.map(row => toCandidate(row, accounts.get(row.account) ?? ''));
}

/**
 * Supplies existing ledger movements for a manual financing allocation. The
 * candidates are read-only; saving an allocation never creates or updates one.
 */
export async function getFinancingBreakdownCandidates(): Promise<FinancingBreakdownCandidates> {
  const profile = await loadHouseholdProfile();
  if (!profile) {
    return { checkingTransactions: [], financingTransactions: [] };
  }
  const checking = new Map(
    profile.accounts
      .filter(account => account.role === 'joint-checking')
      .map(account => [account.id, account.name]),
  );
  const financing = new Map(
    profile.accounts
      .filter(account => isFinancingRole(account.role))
      .map(account => [account.id, account.name]),
  );
  const [checkingTransactions, financingTransactions] = await Promise.all([
    candidatesForAccounts(checking),
    candidatesForAccounts(financing),
  ]);
  return { checkingTransactions, financingTransactions };
}

function requireNonNegativeAmounts(input: SaveFinancingBreakdownInput) {
  for (const [label, value] of Object.entries({
    insurance: input.insuranceAmount,
    interest: input.interestAmount,
    principal: input.principalAmount,
  })) {
    if (!amountIsValid(value)) {
      throw new Error(
        `${label} amount must be a non-negative whole minor-unit value.`,
      );
    }
  }
}

async function ensureNoDuplicateReferences({
  id,
  insuranceTransactionId,
  paymentTransactionId,
  principalTransactionId,
}: {
  id: string;
  insuranceTransactionId: string | null;
  paymentTransactionId: string;
  principalTransactionId: string;
}) {
  const rows = await db.all<
    Pick<
      StoredInstallment,
      | 'id'
      | 'insurance_transaction_id'
      | 'payment_transaction_id'
      | 'principal_transaction_id'
    >
  >(
    `SELECT id, payment_transaction_id, principal_transaction_id,
            insurance_transaction_id
     FROM actuynab_financing_installments
     WHERE tombstone = 0`,
  );
  const referenced = new Set(
    [
      paymentTransactionId,
      principalTransactionId,
      insuranceTransactionId,
    ].filter((value): value is string => Boolean(value)),
  );
  const conflict = rows.find(
    row =>
      row.id !== id &&
      [
        row.payment_transaction_id,
        row.principal_transaction_id,
        row.insurance_transaction_id,
      ].some(reference => reference && referenced.has(reference)),
  );
  if (conflict) {
    throw new Error(
      'One of these movements is already allocated to another financing record.',
    );
  }
}

/**
 * Stores a user-confirmed allocation against existing Actual movements. This
 * metadata is synced, but it deliberately does not create a transfer, split,
 * category, payee, account entry, or reconciliation change.
 */
export async function saveFinancingBreakdown(
  input: SaveFinancingBreakdownInput,
): Promise<FinancingInstallment> {
  requireNonNegativeAmounts(input);
  const profile = await loadHouseholdProfile();
  const financingAccount = profile?.accounts.find(
    account =>
      account.id === input.financingAccountId && isFinancingRole(account.role),
  );
  if (!financingAccount) {
    throw new Error(
      'Choose a configured mortgage or vehicle-financing account.',
    );
  }
  if (
    input.paymentDirection !== 'payment' &&
    input.paymentDirection !== 'refund'
  ) {
    throw new Error(
      'Choose whether the selected checking movement is a payment or refund.',
    );
  }
  const insuranceTransactionId = input.insuranceTransactionId || null;
  const selectedIds = [
    input.paymentTransactionId,
    input.principalTransactionId,
    ...(insuranceTransactionId ? [insuranceTransactionId] : []),
  ];
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('Each financing allocation movement must be distinct.');
  }
  const transactions = await ledgerTransactions(selectedIds);
  const payment = transactions.get(input.paymentTransactionId);
  const principal = transactions.get(input.principalTransactionId);
  const insurance = insuranceTransactionId
    ? transactions.get(insuranceTransactionId)
    : undefined;
  const checkingAccountIds = new Set(
    profile?.accounts
      .filter(account => account.role === 'joint-checking')
      .map(account => account.id),
  );
  if (!payment || !checkingAccountIds.has(payment.account)) {
    throw new Error('Choose an existing joint-checking payment movement.');
  }
  if (!principal || principal.account !== financingAccount.id) {
    throw new Error(
      'Choose an existing movement in the selected financing tracking account.',
    );
  }
  if (
    (input.paymentDirection === 'payment' && payment.amount >= 0) ||
    (input.paymentDirection === 'refund' && payment.amount <= 0)
  ) {
    throw new Error(
      'The payment direction must match the sign of the selected checking movement.',
    );
  }
  if (Math.abs(principal.amount) !== input.principalAmount) {
    throw new Error(
      'Principal must exactly match the selected financing-account movement.',
    );
  }
  if (insuranceTransactionId) {
    if (!insurance || !checkingAccountIds.has(insurance.account)) {
      throw new Error('Choose an existing joint-checking insurance movement.');
    }
    if (
      input.insuranceAmount === 0 ||
      Math.abs(insurance.amount) !== input.insuranceAmount
    ) {
      throw new Error(
        'Separate insurance must exactly match its selected checking movement.',
      );
    }
  }
  const includedAllocation =
    input.principalAmount +
    input.interestAmount +
    (insuranceTransactionId ? 0 : input.insuranceAmount);
  if (includedAllocation !== Math.abs(payment.amount)) {
    throw new Error(
      'Principal, interest, and included insurance must equal the selected payment amount.',
    );
  }

  const id = identifierFor(
    'actuynab-financing-installment',
    input.financingAccountId,
    input.paymentTransactionId,
  );
  await ensureNoDuplicateReferences({
    id,
    insuranceTransactionId,
    paymentTransactionId: input.paymentTransactionId,
    principalTransactionId: input.principalTransactionId,
  });
  const existing = await db.first<Pick<StoredInstallment, 'created_at' | 'id'>>(
    `SELECT id, created_at FROM actuynab_financing_installments
     WHERE id = ? AND tombstone = 0`,
    [id],
  );
  const now = new Date().toISOString();
  const row = {
    id,
    account_id: financingAccount.id,
    payment_transaction_id: payment.id,
    principal_transaction_id: principal.id,
    insurance_transaction_id: insuranceTransactionId,
    payment_amount: Math.abs(payment.amount),
    principal_amount: input.principalAmount,
    interest_amount: input.interestAmount,
    insurance_amount: input.insuranceAmount,
    payment_direction: input.paymentDirection,
    insurance_is_separate: Number(Boolean(insuranceTransactionId)),
    payment_date: db.fromDateRepr(payment.date),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    tombstone: 0,
  };
  await batchMessages(async () => {
    if (existing) {
      await db.update('actuynab_financing_installments', row);
    } else {
      await db.insert('actuynab_financing_installments', row);
    }
  });
  return toInstallment(row, 'verified');
}

export async function deleteFinancingBreakdown({
  id,
}: {
  id: string;
}): Promise<void> {
  const existing = await db.first<{ id: string }>(
    `SELECT id FROM actuynab_financing_installments
     WHERE id = ? AND tombstone = 0`,
    [id],
  );
  if (!existing) {
    throw new Error('Financing allocation record was not found.');
  }
  await batchMessages(async () => {
    await db.update('actuynab_financing_installments', {
      id,
      tombstone: 1,
      updated_at: new Date().toISOString(),
    });
  });
}
