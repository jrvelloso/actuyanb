import { getSheetValue } from '#server/budget/actions';
import { getBudgetType } from '#server/budget/base';
import * as db from '#server/db';
import { batchMessages } from '#server/sync';
import * as monthUtils from '#shared/months';

import type {
  HouseholdAccount,
  HouseholdAccountRole,
} from './actuynab-classification';

export type HouseholdAccountKey =
  | 'activo'
  | 'millenium'
  | 'cc-activo-classic'
  | 'cc-millenium-gold'
  | 'cc-millenium-classic'
  | 'home'
  | 'tesla';

export type HouseholdAccountPreset = {
  defaultName: string;
  defaultTransferDescriptionTokens: readonly string[];
  key: HouseholdAccountKey;
  onBudget: boolean;
  role: HouseholdAccountRole;
};

/**
 * Defaults are convenience suggestions for a new shared household. The
 * persisted account-role mapping, rather than a display name, drives all
 * import classification after setup.
 */
export const HOUSEHOLD_ACCOUNT_PRESETS: readonly HouseholdAccountPreset[] = [
  {
    key: 'activo',
    defaultName: 'Activo',
    onBudget: true,
    role: 'joint-checking',
    defaultTransferDescriptionTokens: ['TRANSFERENCIA PARA ACTIVO'],
  },
  {
    key: 'millenium',
    defaultName: 'Millenium',
    onBudget: true,
    role: 'joint-checking',
    defaultTransferDescriptionTokens: ['TRANSFERENCIA PARA MILLENIUM'],
  },
  {
    key: 'cc-activo-classic',
    defaultName: 'CC-Activo-Classic',
    onBudget: true,
    role: 'credit-card',
    defaultTransferDescriptionTokens: ['PAGAMENTO CC ACTIVO CLASSIC'],
  },
  {
    key: 'cc-millenium-gold',
    defaultName: 'CC-Millenium-Gold',
    onBudget: true,
    role: 'credit-card',
    defaultTransferDescriptionTokens: ['PAGAMENTO CC MILLENIUM GOLD'],
  },
  {
    key: 'cc-millenium-classic',
    defaultName: 'CC-Millenium-Classic',
    onBudget: true,
    role: 'credit-card',
    defaultTransferDescriptionTokens: ['PAGAMENTO CC MILLENIUM CLASSIC'],
  },
  {
    key: 'home',
    defaultName: 'Home',
    onBudget: false,
    role: 'mortgage',
    defaultTransferDescriptionTokens: ['PRESTACAO CASA HOME'],
  },
  {
    key: 'tesla',
    defaultName: 'Tesla',
    onBudget: false,
    role: 'vehicle-financing',
    defaultTransferDescriptionTokens: ['PAGAMENTO TESLA FINANCIAMENTO'],
  },
];

const PROFILE_ID = 'actuynab-household-primary';

const HOUSEHOLD_CATEGORY_TEMPLATE = [
  ['Housing', ['Mortgage interest', 'Home insurance', 'Home maintenance']],
  ['Monthly Bills', ['Electricity', 'Water', 'Internet and mobile']],
  ['Food', ['Groceries', 'Dining out']],
  ['Transport', ['Fuel', 'Public transport', 'Vehicle maintenance']],
  ['Health & Personal Care', ['Healthcare', 'Personal care']],
  ['Lifestyle', ['Entertainment', 'Clothing', 'Gifts']],
  ['Sports', ['Sports & fitness']],
  ['Irregular Expenses', ['Annual bills', 'Travel']],
  ['Savings Goals', ['Emergency fund', 'Holidays']],
] as const;

type StoredProfile = {
  category_template_applied: number;
  id: string;
};

type StoredAccountRole = {
  account_id: string;
  account_name: string;
  account_offbudget: number;
  id: string;
  role: HouseholdAccountRole;
  role_key: HouseholdAccountKey;
  transfer_description_tokens: string | null;
};

export type HouseholdSetupAccount = {
  accountId?: string | null;
  key: HouseholdAccountKey;
  name: string;
  transferDescriptionTokens?: string[];
};

export type ConfigureHouseholdInput = {
  accounts: HouseholdSetupAccount[];
  applyCategoryTemplate?: boolean;
};

export type HouseholdProfile = {
  accounts: HouseholdConfiguredAccount[];
  categoryTemplateApplied: boolean;
  id: string;
};

export type HouseholdConfiguredAccount = HouseholdAccount & {
  key: HouseholdAccountKey;
};

export type HouseholdSetupResult = {
  createdAccountIds: string[];
  createdCategories: number;
  createdCategoryGroups: number;
  matchedAccountIds: string[];
  profile: HouseholdProfile;
};

export type HouseholdOverviewAccount = {
  balance: number;
  id: string;
  name: string;
  role: HouseholdAccountRole;
};

export type HouseholdOverview = {
  availableBudget: number;
  availableBudgetLabel: 'available-to-budget' | 'available-savings';
  checkingAccounts: HouseholdOverviewAccount[];
  creditCardLiabilities: HouseholdOverviewAccount[];
  financingAccounts: HouseholdOverviewAccount[];
  isConfigured: boolean;
  monthlySpending: number;
  pendingImportReviews: number;
  totalCreditCardLiabilities: number;
  totalFinancingLiabilities: number;
  totalLiabilities: number;
  upcomingBills: Array<{
    amount: number | null;
    date: string;
    id: string;
    payee: string | null;
  }>;
};

function identifierFor(scope: string, key: HouseholdAccountKey): string {
  return `actuynab-${scope}-${key}`;
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase();
}

function presetFor(key: HouseholdAccountKey): HouseholdAccountPreset {
  const preset = HOUSEHOLD_ACCOUNT_PRESETS.find(item => item.key === key);
  if (!preset) {
    throw new Error(`Unknown household account role: ${key}`);
  }
  return preset;
}

function parseTokens(value: string | null): string[] {
  if (!value) return [];
  try {
    const tokens: unknown = JSON.parse(value);
    if (!Array.isArray(tokens)) return [];
    return tokens.filter(
      (token): token is string => typeof token === 'string' && token !== '',
    );
  } catch {
    return [];
  }
}

function cleanTokens(tokens: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (tokens ?? []).map(token => token.trim()).filter(token => token !== ''),
    ),
  ];
}

async function storedRoles(): Promise<StoredAccountRole[]> {
  return db.all<StoredAccountRole>(
    `
    SELECT r.id, r.account_id, r.role_key, r.role,
           r.transfer_description_tokens, a.name AS account_name,
           a.offbudget AS account_offbudget
    FROM actuynab_household_account_roles r
    JOIN accounts a ON a.id = r.account_id AND a.tombstone = 0
    WHERE r.profile_id = ? AND r.tombstone = 0
    ORDER BY r.role_key
  `,
    [PROFILE_ID],
  );
}

export async function loadHouseholdProfile(): Promise<HouseholdProfile | null> {
  const profile = await db.first<StoredProfile>(
    'SELECT id, category_template_applied FROM actuynab_household_profiles WHERE id = ? AND tombstone = 0',
    [PROFILE_ID],
  );
  if (!profile) return null;

  const roles = await storedRoles();
  return {
    id: profile.id,
    categoryTemplateApplied: Boolean(profile.category_template_applied),
    accounts: roles.map(role => ({
      id: role.account_id,
      key: role.role_key,
      name: role.account_name,
      onBudget: role.account_offbudget !== 1,
      role: role.role,
      transferDescriptionTokens: parseTokens(role.transfer_description_tokens),
    })),
  };
}

async function applyCategoryTemplate(): Promise<{
  categories: number;
  groups: number;
}> {
  const existingGroups = new Map(
    (await db.getCategoriesGrouped()).map(group => [
      normalizedName(group.name),
      {
        id: group.id,
        categoryNames: new Set(
          (group.categories ?? []).map(category =>
            normalizedName(category.name),
          ),
        ),
      },
    ]),
  );
  let createdCategories = 0;
  let createdGroups = 0;

  for (const [groupName, categoryNames] of HOUSEHOLD_CATEGORY_TEMPLATE) {
    const normalizedGroupName = normalizedName(groupName);
    let group = existingGroups.get(normalizedGroupName);
    if (!group) {
      const id = await db.insertCategoryGroup({
        name: groupName,
        is_income: 0,
        hidden: 0,
      });
      group = { id, categoryNames: new Set() };
      existingGroups.set(normalizedGroupName, group);
      createdGroups++;
    }

    for (const categoryName of categoryNames) {
      const normalizedCategoryName = normalizedName(categoryName);
      if (group.categoryNames.has(normalizedCategoryName)) {
        continue;
      }
      await db.insertCategory({
        name: categoryName,
        cat_group: group.id,
        is_income: 0,
        hidden: 0,
      });
      group.categoryNames.add(normalizedCategoryName);
      createdCategories++;
    }
  }

  return { categories: createdCategories, groups: createdGroups };
}

function validateInput(accounts: HouseholdSetupAccount[]) {
  const keys = new Set(accounts.map(account => account.key));
  if (
    accounts.length !== HOUSEHOLD_ACCOUNT_PRESETS.length ||
    keys.size !== HOUSEHOLD_ACCOUNT_PRESETS.length ||
    HOUSEHOLD_ACCOUNT_PRESETS.some(preset => !keys.has(preset.key))
  ) {
    throw new Error(
      'A household setup must configure each required account role.',
    );
  }
  if (accounts.some(account => account.name.trim() === '')) {
    throw new Error('Household account names cannot be blank.');
  }
  const explicitAccountIds = accounts
    .map(account => account.accountId)
    .filter((id): id is string => Boolean(id));
  if (new Set(explicitAccountIds).size !== explicitAccountIds.length) {
    throw new Error('Each household role must use a different Actual account.');
  }
  const configuredAccountNames = accounts.map(account => {
    const preset = presetFor(account.key);
    return `${Number(!preset.onBudget)}:${normalizedName(account.name)}`;
  });
  if (new Set(configuredAccountNames).size !== configuredAccountNames.length) {
    throw new Error(
      'Each household account role must have a distinct compatible account name.',
    );
  }
}

/**
 * Creates or adopts the selected Actual accounts and persists their household
 * roles. It never changes an adopted account's balance, transactions, or
 * off-budget state. Repeating the same setup is intentionally a no-op.
 */
export async function configureHousehold(
  input: ConfigureHouseholdInput,
): Promise<HouseholdSetupResult> {
  validateInput(input.accounts);
  const existingRoles = new Map(
    (await storedRoles()).map(role => [role.role_key, role]),
  );
  const existingRoleKeys = new Set(
    (
      await db.all<{ role_key: HouseholdAccountKey }>(
        `SELECT role_key FROM actuynab_household_account_roles
         WHERE profile_id = ? AND tombstone = 0`,
        [PROFILE_ID],
      )
    ).map(role => role.role_key),
  );
  const accounts = await db.getAccounts();
  const resolvedAccountIds = new Set<string>();
  const createdAccountIds: string[] = [];
  const matchedAccountIds: string[] = [];
  let templateResult = { categories: 0, groups: 0 };

  await batchMessages(async () => {
    for (const configured of input.accounts) {
      const preset = presetFor(configured.key);
      const expectedOffBudget: 0 | 1 = preset.onBudget ? 0 : 1;
      const existingRole = existingRoles.get(configured.key);
      let account = configured.accountId
        ? accounts.find(candidate => candidate.id === configured.accountId)
        : undefined;

      if (configured.accountId && !account) {
        throw new Error(
          `The selected account for ${configured.key} no longer exists. Reload the setup and choose an account again.`,
        );
      }
      if (
        !account &&
        existingRole &&
        normalizedName(existingRole.account_name) ===
          normalizedName(configured.name)
      ) {
        account = accounts.find(
          candidate => candidate.id === existingRole.account_id,
        );
      }
      if (!account) {
        const matches = accounts.filter(
          candidate =>
            candidate.offbudget === expectedOffBudget &&
            normalizedName(candidate.name) === normalizedName(configured.name),
        );
        if (matches.length > 1) {
          throw new Error(
            `More than one matching ${configured.name.trim()} account exists. Choose the intended account explicitly.`,
          );
        }
        account = matches[0];
      }
      if (account && account.offbudget !== expectedOffBudget) {
        throw new Error(
          `${account.name} has the wrong on/off-budget type for ${configured.key}.`,
        );
      }
      let accountId: string;
      if (!account) {
        accountId = identifierFor('household-account', configured.key);
        await db.insertAccount({
          id: accountId,
          name: configured.name.trim(),
          offbudget: expectedOffBudget,
          closed: 0,
        });
        await db.insertPayee({ name: '', transfer_acct: accountId });
        createdAccountIds.push(accountId);
      } else {
        accountId = account.id;
        matchedAccountIds.push(account.id);
      }
      if (resolvedAccountIds.has(accountId)) {
        throw new Error(
          'Each household role must use a different Actual account.',
        );
      }
      resolvedAccountIds.add(accountId);
      const transferPayee = await db.first<{ id: string }>(
        'SELECT id FROM payees WHERE transfer_acct = ? AND tombstone = 0',
        [accountId],
      );
      if (!transferPayee) {
        await db.insertPayee({ name: '', transfer_acct: accountId });
      }

      const id = identifierFor('household-role', configured.key);
      const tokens = cleanTokens(
        configured.transferDescriptionTokens ??
          preset.defaultTransferDescriptionTokens,
      );
      const row = {
        id,
        profile_id: PROFILE_ID,
        account_id: accountId,
        role_key: configured.key,
        role: preset.role,
        transfer_description_tokens: JSON.stringify(tokens),
        tombstone: 0,
      };
      if (existingRoleKeys.has(configured.key)) {
        await db.update('actuynab_household_account_roles', row);
      } else {
        await db.insert('actuynab_household_account_roles', row);
      }
    }

    const profile = await db.first<StoredProfile>(
      'SELECT id, category_template_applied FROM actuynab_household_profiles WHERE id = ?',
      [PROFILE_ID],
    );
    if (input.applyCategoryTemplate) {
      templateResult = await applyCategoryTemplate();
    }
    const profileRow = {
      id: PROFILE_ID,
      category_template_applied: Number(
        Boolean(
          input.applyCategoryTemplate || profile?.category_template_applied,
        ),
      ),
      updated_at: new Date().toISOString(),
      tombstone: 0,
    };
    if (profile) {
      await db.update('actuynab_household_profiles', profileRow);
    } else {
      await db.insert('actuynab_household_profiles', profileRow);
    }
  });

  const profile = await loadHouseholdProfile();
  if (!profile) {
    throw new Error('Unable to save the household configuration.');
  }
  return {
    createdAccountIds,
    matchedAccountIds,
    createdCategories: templateResult.categories,
    createdCategoryGroups: templateResult.groups,
    profile,
  };
}

async function accountBalances(accountIds: readonly string[]) {
  if (accountIds.length === 0) return new Map<string, number>();
  const ids = [...accountIds];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await db.all<{ account: string; balance: number }>(
    `SELECT account, COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account IN (${placeholders})
       AND is_parent = 0
     GROUP BY account`,
    ids,
  );
  return new Map(rows.map(row => [row.account, row.balance]));
}

function overviewAccounts(
  accounts: readonly HouseholdAccount[],
  balances: ReadonlyMap<string, number>,
  roles: readonly HouseholdAccountRole[],
): HouseholdOverviewAccount[] {
  return accounts
    .filter(account => roles.includes(account.role))
    .map(account => ({
      id: account.id,
      name: account.name,
      role: account.role,
      balance: balances.get(account.id) ?? 0,
    }));
}

export async function getHouseholdOverview(): Promise<HouseholdOverview> {
  const profile = await loadHouseholdProfile();
  if (!profile) {
    return {
      isConfigured: false,
      availableBudget: 0,
      availableBudgetLabel: 'available-to-budget',
      checkingAccounts: [],
      creditCardLiabilities: [],
      financingAccounts: [],
      monthlySpending: 0,
      pendingImportReviews: 0,
      totalCreditCardLiabilities: 0,
      totalFinancingLiabilities: 0,
      totalLiabilities: 0,
      upcomingBills: [],
    };
  }

  const accountIds = profile.accounts.map(account => account.id);
  const balances = await accountBalances(accountIds);
  const month = monthUtils.currentMonth();
  const { start, end } = monthUtils.bounds(month);
  const onBudgetIds = profile.accounts
    .filter(account => account.onBudget)
    .map(account => account.id);
  const [spending, pending, schedules] = await Promise.all([
    onBudgetIds.length === 0
      ? Promise.resolve({ amount: 0 })
      : db.first<{ amount: number }>(
          `SELECT COALESCE(SUM(-amount), 0) AS amount
           FROM v_transactions
           WHERE account IN (${onBudgetIds.map(() => '?').join(', ')})
             AND category IS NOT NULL
             AND is_parent = 0
             AND date BETWEEN ? AND ?`,
          [...onBudgetIds, start, end],
        ),
    db.first<{ count: number }>(
      `SELECT COUNT(*) AS count FROM actuynab_import_batches
       WHERE tombstone = 0
         AND review_status IN ('pending', 'partially-confirmed')`,
    ),
    db.all<{
      amount: number | null;
      id: string;
      next_date: string;
      payee: string | null;
    }>(
      `SELECT s.id, s.next_date, s._amount AS amount, p.name AS payee
       FROM v_schedules s
       LEFT JOIN payees p ON p.id = s._payee AND p.tombstone = 0
       WHERE s.tombstone = 0
         AND s.completed = 0
         AND s.next_date IS NOT NULL
       ORDER BY s.next_date
       LIMIT 5`,
    ),
  ]);
  let availableBudgetLabel: HouseholdOverview['availableBudgetLabel'] =
    'available-to-budget';
  let availableBudget = 0;
  try {
    availableBudgetLabel =
      getBudgetType() === 'envelope'
        ? 'available-to-budget'
        : 'available-savings';
    availableBudget = await getSheetValue(
      monthUtils.sheetForMonth(month),
      availableBudgetLabel === 'available-to-budget'
        ? 'to-budget'
        : 'total-saved',
    );
  } catch {
    // A fresh, not-yet-initialized test budget has no spreadsheet. The rest
    // of the ledger overview remains safe and useful at zero availability.
  }
  const checkingAccounts = overviewAccounts(profile.accounts, balances, [
    'joint-checking',
  ]);
  const creditCardLiabilities = overviewAccounts(profile.accounts, balances, [
    'credit-card',
  ]);
  const financingAccounts = overviewAccounts(profile.accounts, balances, [
    'mortgage',
    'vehicle-financing',
  ]);
  const totalCreditCardLiabilities = creditCardLiabilities.reduce(
    (total, account) => total + Math.abs(account.balance),
    0,
  );
  const totalFinancingLiabilities = financingAccounts.reduce(
    (total, account) => total + Math.abs(account.balance),
    0,
  );

  return {
    isConfigured: true,
    availableBudget,
    availableBudgetLabel,
    checkingAccounts,
    creditCardLiabilities,
    financingAccounts,
    monthlySpending: spending?.amount ?? 0,
    pendingImportReviews: pending?.count ?? 0,
    totalCreditCardLiabilities,
    totalFinancingLiabilities,
    totalLiabilities: totalCreditCardLiabilities + totalFinancingLiabilities,
    upcomingBills: schedules.map(schedule => ({
      id: schedule.id,
      date: schedule.next_date,
      amount: schedule.amount,
      payee: schedule.payee,
    })),
  };
}
