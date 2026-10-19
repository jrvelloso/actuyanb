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

type HouseholdCategoryTemplateGroup = {
  categories: readonly string[];
  name: string;
};

export type HouseholdCategoryTemplateKind = 'personal' | 'starter';

const STARTER_CATEGORY_TEMPLATE: readonly HouseholdCategoryTemplateGroup[] = [
  {
    name: 'Housing',
    categories: ['Mortgage interest', 'Home insurance', 'Home maintenance'],
  },
  {
    name: 'Monthly Bills',
    categories: ['Electricity', 'Water', 'Internet and mobile'],
  },
  { name: 'Food', categories: ['Groceries', 'Dining out'] },
  {
    name: 'Transport',
    categories: ['Fuel', 'Public transport', 'Vehicle maintenance'],
  },
  {
    name: 'Health & Personal Care',
    categories: ['Healthcare', 'Personal care'],
  },
  { name: 'Lifestyle', categories: ['Entertainment', 'Clothing', 'Gifts'] },
  { name: 'Sports', categories: ['Sports & fitness'] },
  { name: 'Irregular Expenses', categories: ['Annual bills', 'Travel'] },
  { name: 'Savings Goals', categories: ['Emergency fund', 'Holidays'] },
];

const PERSONAL_CATEGORY_TEMPLATE: readonly HouseholdCategoryTemplateGroup[] = [
  { name: 'Car', categories: ['Car Insurance', 'Car Payment', 'Fuel'] },
  {
    name: 'Everyday Expenses',
    categories: ['Household Goods', 'Medical', 'Restaurants', 'Spending Money'],
  },
  { name: 'Food', categories: ['Supermarket', 'Take out food'] },
  { name: 'Fun', categories: ['Books', 'Tech'] },
  {
    name: 'Health Care',
    categories: [
      'Clothing',
      'Doctors',
      'Hair',
      'Health Insurance',
      'Nails',
      'Pharmacy',
    ],
  },
  { name: 'Home', categories: ['Home Maintenance', 'Home Stuff', 'Mortgage'] },
  {
    name: 'Monthly Bills',
    categories: ['Electricity', 'Housekeeping', 'Internet', 'Mobile', 'Water'],
  },
  {
    name: 'Rainy Day Funds',
    categories: ['Birthdays', 'Christmas', 'Emergency Fund', 'Life Insurance'],
  },
  { name: 'Savings Goals', categories: ['Tech', 'Vacation'] },
  { name: 'Sports', categories: ['Gym', 'Paddel'] },
];

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
  categoryTemplate?: HouseholdCategoryTemplateKind | null;
};

export type HouseholdSetupPreviewAccount = {
  accountId: string | null;
  key: HouseholdAccountKey;
  message: string | null;
  name: string;
  onBudget: boolean;
  status: 'conflict' | 'create' | 'reuse';
};

export type HouseholdSetupPreviewCategory = {
  message: string | null;
  name: string;
  status: 'conflict' | 'create' | 'reuse';
};

export type HouseholdSetupPreviewCategoryGroup = {
  categories: HouseholdSetupPreviewCategory[];
  message: string | null;
  name: string;
  status: 'conflict' | 'create' | 'reuse';
};

export type HouseholdSetupPreview = {
  accounts: HouseholdSetupPreviewAccount[];
  categoryGroups: HouseholdSetupPreviewCategoryGroup[];
  categoryTemplate: HouseholdCategoryTemplateKind | null;
  conflicts: string[];
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

/**
 * Returns a deterministic, display-name-based ordering without mutating the
 * supplied template. Existing budget categories are deliberately not passed
 * through this helper: their manual ordering remains an Actual user choice.
 */
export function sortHouseholdCategoryTemplate(
  template: readonly HouseholdCategoryTemplateGroup[],
): HouseholdCategoryTemplateGroup[] {
  return template
    .map(group => ({
      name: group.name,
      categories: [...group.categories].sort((left, right) =>
        left.localeCompare(right, 'en', { sensitivity: 'base' }),
      ),
    }))
    .sort((left, right) =>
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }),
    );
}

function selectedCategoryTemplate(
  input: Pick<
    ConfigureHouseholdInput,
    'applyCategoryTemplate' | 'categoryTemplate'
  >,
): HouseholdCategoryTemplateKind | null {
  if (
    input.categoryTemplate === 'personal' ||
    input.categoryTemplate === 'starter'
  ) {
    return input.categoryTemplate;
  }
  return input.applyCategoryTemplate ? 'starter' : null;
}

function categoryTemplateFor(
  kind: HouseholdCategoryTemplateKind,
): readonly HouseholdCategoryTemplateGroup[] {
  return kind === 'personal'
    ? sortHouseholdCategoryTemplate(PERSONAL_CATEGORY_TEMPLATE)
    : STARTER_CATEGORY_TEMPLATE;
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

async function previewCategoryTemplate(
  kind: HouseholdCategoryTemplateKind,
): Promise<HouseholdSetupPreviewCategoryGroup[]> {
  const groupsByName = new Map<
    string,
    Awaited<ReturnType<typeof db.getCategoriesGrouped>>
  >();
  for (const group of await db.getCategoriesGrouped()) {
    const key = normalizedName(group.name);
    groupsByName.set(key, [...(groupsByName.get(key) ?? []), group]);
  }

  return categoryTemplateFor(kind).map(({ name, categories }) => {
    const matchingGroups = groupsByName.get(normalizedName(name)) ?? [];
    if (matchingGroups.length !== 1) {
      const message =
        matchingGroups.length === 0
          ? null
          : `More than one existing category group is named ${name}.`;
      return {
        name,
        status: matchingGroups.length === 0 ? 'create' : 'conflict',
        message,
        categories: categories.map(category => ({
          name: category,
          status: matchingGroups.length === 0 ? 'create' : 'conflict',
          message,
        })),
      };
    }

    const group = matchingGroups[0];
    if (group.is_income === 1 || group.hidden === 1) {
      const message = `${group.name} is not a visible spending category group.`;
      return {
        name,
        status: 'conflict',
        message,
        categories: categories.map(category => ({
          name: category,
          status: 'conflict',
          message,
        })),
      };
    }

    return {
      name,
      status: 'reuse',
      message: null,
      categories: categories.map(category => {
        const matchingCategories = (group.categories ?? []).filter(
          existing =>
            normalizedName(existing.name) === normalizedName(category),
        );
        if (matchingCategories.length !== 1) {
          const message =
            matchingCategories.length === 0
              ? null
              : `More than one category named ${category} exists in ${name}.`;
          return {
            name: category,
            status: matchingCategories.length === 0 ? 'create' : 'conflict',
            message,
          };
        }
        const existing = matchingCategories[0];
        if (existing.is_income === 1 || existing.hidden === 1) {
          return {
            name: category,
            status: 'conflict',
            message: `${existing.name} is not a visible spending category.`,
          };
        }
        return { name: category, status: 'reuse', message: null };
      }),
    };
  });
}

async function applyCategoryTemplate(
  kind: HouseholdCategoryTemplateKind,
  preview: readonly HouseholdSetupPreviewCategoryGroup[],
): Promise<{ categories: number; groups: number }> {
  const groupIds = new Map<string, string>();
  const existingGroups = await db.getCategoriesGrouped();
  for (const group of existingGroups) {
    groupIds.set(normalizedName(group.name), group.id);
  }

  let createdCategories = 0;
  let createdGroups = 0;
  for (const group of preview) {
    let groupId = groupIds.get(normalizedName(group.name));
    if (group.status === 'create') {
      groupId = await db.insertCategoryGroup({
        name: group.name,
        is_income: 0,
        hidden: 0,
      });
      groupIds.set(normalizedName(group.name), groupId);
      createdGroups++;
    }
    if (!groupId) {
      throw new Error(`Unable to resolve the ${group.name} category group.`);
    }

    for (const category of group.categories) {
      if (category.status !== 'create') continue;
      await db.insertCategory(
        {
          name: category.name,
          cat_group: groupId,
          is_income: 0,
          hidden: 0,
        },
        // New personal-template categories are inserted in sorted sequence at
        // the end of a group, preserving an existing user's manual ordering.
        { atEnd: kind === 'personal' },
      );
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
 * Produces the exact account/category plan shown before setup writes anything.
 * The result deliberately identifies ambiguous or incompatible existing rows
 * instead of guessing from an account or category name.
 */
export async function previewHouseholdSetup(
  input: ConfigureHouseholdInput,
): Promise<HouseholdSetupPreview> {
  try {
    validateInput(input.accounts);
  } catch (error) {
    return {
      accounts: [],
      categoryGroups: [],
      categoryTemplate: null,
      conflicts: [
        error instanceof Error ? error.message : 'Invalid household setup.',
      ],
    };
  }

  const [accounts, roles] = await Promise.all([
    db.getAccounts(),
    storedRoles(),
  ]);
  const rolesByKey = new Map(roles.map(role => [role.role_key, role]));
  const resolvedAccountIds = new Set<string>();
  const conflicts: string[] = [];
  const previewAccounts = input.accounts.map(configured => {
    const preset = presetFor(configured.key);
    const expectedOffBudget: 0 | 1 = preset.onBudget ? 0 : 1;
    const existingRole = rolesByKey.get(configured.key);
    let account = configured.accountId
      ? accounts.find(candidate => candidate.id === configured.accountId)
      : undefined;
    let message: string | null = null;

    if (configured.accountId && !account) {
      message = `The selected account for ${configured.key} no longer exists.`;
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
    if (!account && !message) {
      const nameMatches = accounts.filter(
        candidate =>
          normalizedName(candidate.name) === normalizedName(configured.name),
      );
      const compatibleMatches = nameMatches.filter(
        candidate => candidate.offbudget === expectedOffBudget,
      );
      if (compatibleMatches.length === 1) {
        account = compatibleMatches[0];
      } else if (compatibleMatches.length > 1) {
        message = `More than one compatible account is named ${configured.name.trim()}. Choose one explicitly.`;
      } else if (nameMatches.length > 0) {
        message = `${configured.name.trim()} exists with an incompatible on/off-budget type. Choose a compatible account or a different name.`;
      }
    }
    if (account && account.offbudget !== expectedOffBudget) {
      message = `${account.name} has the wrong on/off-budget type for ${configured.key}.`;
    }
    if (account && resolvedAccountIds.has(account.id)) {
      message = `${account.name} is selected for more than one household role.`;
    }
    if (account) resolvedAccountIds.add(account.id);
    if (message) conflicts.push(message);

    return {
      accountId: account?.id ?? null,
      key: configured.key,
      message,
      name: configured.name.trim(),
      onBudget: preset.onBudget,
      status: message ? 'conflict' : account ? 'reuse' : 'create',
    } satisfies HouseholdSetupPreviewAccount;
  });

  const categoryTemplate = selectedCategoryTemplate(input);
  const categoryGroups = categoryTemplate
    ? await previewCategoryTemplate(categoryTemplate)
    : [];
  for (const group of categoryGroups) {
    if (group.message) conflicts.push(group.message);
    for (const category of group.categories) {
      if (category.message) conflicts.push(category.message);
    }
  }

  return {
    accounts: previewAccounts,
    categoryGroups,
    categoryTemplate,
    conflicts: [...new Set(conflicts)],
  };
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
  const preview = await previewHouseholdSetup(input);
  if (preview.conflicts.length > 0) {
    throw new Error(preview.conflicts.join(' '));
  }
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
    if (preview.categoryTemplate) {
      templateResult = await applyCategoryTemplate(
        preview.categoryTemplate,
        preview.categoryGroups,
      );
    }
    const profileRow = {
      id: PROFILE_ID,
      category_template_applied: Number(
        Boolean(preview.categoryTemplate || profile?.category_template_applied),
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

export async function getHouseholdOverview({
  month = monthUtils.currentMonth(),
}: {
  month?: string;
} = {}): Promise<HouseholdOverview> {
  if (!monthUtils.isValidYearMonth(month)) {
    throw new Error('Choose a valid household overview month.');
  }
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
