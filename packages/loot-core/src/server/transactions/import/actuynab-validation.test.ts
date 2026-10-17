// @ts-strict-ignore
import * as d from 'date-fns';

import { addTransactions, reconcileTransactions } from '#server/accounts/sync';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { createSchedule } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import { amountToInteger } from '#shared/util';

import { parseFile } from './parse-file';

type ParsedTransaction = {
  amount: number | string;
  category?: string | null;
  date: string;
  imported_id?: string;
  imported_payee?: string | null;
  notes?: string | null;
  payee_name?: string | null;
} & Record<string, string | number | null | undefined>;

const fixtures = __dirname + '/../../../mocks/files/';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await prefs.loadPrefs();
});

async function parseFixture(filename: string, options = {}) {
  // The OFX/XML parsers use the current date internally; restore the real
  // clock for parsing but return to the deterministic test clock afterwards.
  global.restoreDateNow();
  try {
    const { errors, transactions } = await parseFile(
      fixtures + filename,
      options,
    );
    expect(errors).toEqual([]);
    return transactions as ParsedTransaction[];
  } finally {
    global.restoreFakeDateNow();
  }
}

async function balance(account: string) {
  const row = await db.first<{ balance: number }>(
    'SELECT SUM(amount) AS balance FROM transactions WHERE acct = ? AND isParent = 0 AND tombstone = 0',
    [account],
  );
  return row?.balance ?? 0;
}

async function combinedBalance() {
  const accounts = ['m1-checking', 'm1-savings', 'm1-credit'];
  const balances = await Promise.all(accounts.map(balance));
  return balances.reduce((total, value) => total + value, 0);
}

async function parentTransactionCount(account: string) {
  const row = await db.first<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions WHERE acct = ? AND isChild = 0 AND tombstone = 0',
    [account],
  );
  return row?.count ?? 0;
}

async function createSyntheticBudget() {
  await db.insertCategoryGroup({
    id: 'm1-income-group',
    name: 'Income',
    is_income: 1,
  });
  await db.insertCategoryGroup({
    id: 'm1-expenses-group',
    name: 'Expenses',
    is_income: 0,
  });

  for (const [id, name, catGroup] of [
    ['m1-salary', 'Salary', 'm1-income-group'],
    ['m1-interest', 'Interest', 'm1-income-group'],
    ['m1-rent', 'Rent', 'm1-expenses-group'],
    ['m1-utilities', 'Utilities', 'm1-expenses-group'],
    ['m1-groceries', 'Groceries', 'm1-expenses-group'],
    ['m1-household', 'Household', 'm1-expenses-group'],
    ['m1-entertainment', 'Entertainment', 'm1-expenses-group'],
    ['m1-travel', 'Travel', 'm1-expenses-group'],
  ]) {
    await db.insertCategory({ id, name, cat_group: catGroup });
  }

  await db.insertAccount({ id: 'm1-checking', name: 'Everyday checking' });
  await db.insertAccount({ id: 'm1-savings', name: 'Rainy-day savings' });
  await db.insertAccount({
    id: 'm1-credit',
    name: 'Credit card',
    offbudget: 0,
    type: 'credit',
  });
  await db.insertPayee({
    id: 'm1-transfer-checking',
    name: '',
    transfer_acct: 'm1-checking',
  });
  await db.insertPayee({
    id: 'm1-transfer-savings',
    name: '',
    transfer_acct: 'm1-savings',
  });
  await db.insertPayee({ id: 'm1-broadband', name: 'Example Broadband' });

  const schedule = await createSchedule({
    schedule: { name: 'Example Broadband', posts_transaction: false },
    conditions: [
      { field: 'account', op: 'is', value: 'm1-checking' },
      { field: 'payee', op: 'is', value: 'm1-broadband' },
      { field: 'amount', op: 'is', value: -4500 },
      {
        field: 'date',
        op: 'isapprox',
        value: { start: '2024-01-28', frequency: 'monthly', patterns: [] },
      },
    ],
  });

  await addTransactions(
    'm1-checking',
    [
      {
        date: '2024-01-01',
        amount: 150000,
        payee_name: 'Opening balance',
        category: 'm1-salary',
      },
      {
        date: '2024-01-05',
        amount: 350000,
        payee_name: 'Example Employer',
        category: 'm1-salary',
      },
      {
        date: '2024-01-10',
        amount: -120000,
        payee_name: 'Example Landlord',
        category: 'm1-rent',
      },
      {
        date: '2024-02-10',
        amount: -120000,
        payee_name: 'Example Landlord',
        category: 'm1-rent',
      },
      {
        date: '2024-01-28',
        amount: -4500,
        payee: 'm1-broadband',
        category: 'm1-utilities',
      },
      {
        date: '2024-02-28',
        amount: -4500,
        payee: 'm1-broadband',
        category: 'm1-utilities',
      },
    ],
    { runTransfers: false },
  );
  await addTransactions(
    'm1-savings',
    [
      {
        date: '2024-01-01',
        amount: 500000,
        payee_name: 'Opening balance',
        category: 'm1-salary',
      },
    ],
    { runTransfers: false },
  );
  await addTransactions(
    'm1-credit',
    [
      {
        date: '2024-01-01',
        amount: -25000,
        payee_name: 'Opening balance',
        category: 'm1-household',
      },
    ],
    { runTransfers: false },
  );
  const split = await addTransactions(
    'm1-checking',
    [
      {
        date: '2024-02-20',
        amount: -8250,
        payee_name: 'Example Market',
        subtransactions: [
          { amount: -7000, category: 'm1-groceries' },
          { amount: -1250, category: 'm1-household' },
        ],
      },
    ],
    { runTransfers: false },
  );

  return { schedule, split };
}

describe('ActuYNAB Milestone 1 synthetic financial validation', () => {
  test('creates historical accounts, categories, a recurring schedule, a split, and a balanced transfer', async () => {
    const { schedule, split } = await createSyntheticBudget();

    expect(
      await db.first('SELECT id FROM schedules WHERE id = ?', [schedule]),
    ).toBeTruthy();
    expect(split).toHaveLength(3);
    const splitRows = await db.all<db.DbViewTransaction>(
      'SELECT * FROM v_transactions WHERE id IN (?, ?, ?)',
      split,
    );
    expect(splitRows.find(transaction => transaction.is_parent)?.amount).toBe(
      -8250,
    );
    expect(
      splitRows
        .filter(transaction => transaction.is_child)
        .reduce((total, transaction) => total + transaction.amount, 0),
    ).toBe(-8250);

    const beforeTransfer = await combinedBalance();
    await addTransactions('m1-checking', [
      {
        date: '2024-02-25',
        amount: -50000,
        payee: 'm1-transfer-savings',
      },
    ]);
    const transferRows = await db.all<db.DbViewTransaction>(
      'SELECT * FROM v_transactions WHERE transfer_id IS NOT NULL',
    );

    expect(transferRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: 'm1-checking', amount: -50000 }),
        expect.objectContaining({ account: 'm1-savings', amount: 50000 }),
      ]),
    );
    expect(await combinedBalance()).toBe(beforeTransfer);
    await expect(
      Promise.all(['m1-checking', 'm1-savings', 'm1-credit'].map(balance)),
    ).resolves.toEqual([192750, 550000, -25000]);
  });

  test('imports CSV, OFX, QIF, and CAMT statements repeatedly without duplicate financial transactions', async () => {
    await createSyntheticBudget();
    await addTransactions('m1-checking', [
      {
        date: '2024-02-25',
        amount: -50000,
        payee: 'm1-transfer-savings',
      },
    ]);
    const categories = new Map(
      (await db.getCategories()).map(category => [category.name, category.id]),
    );
    const beforeImport = await combinedBalance();

    const csv = (
      await parseFixture('actuynab-m1-checking.csv', {
        hasHeaderRow: true,
      })
    ).map(transaction => ({
      date: transaction.Date as string,
      amount: amountToInteger(Number(transaction.Amount)),
      payee_name: transaction.Payee as string,
      imported_payee: transaction.Payee as string,
      notes: transaction.Notes as string,
      category: categories.get(transaction.Category as string),
    }));
    const ofx = (
      await parseFixture('actuynab-m1-credit.ofx', {
        importNotes: true,
      })
    ).map(transaction => ({
      ...transaction,
      amount: amountToInteger(Number(transaction.amount)),
      category: categories.get('Groceries'),
    }));
    const qif = (
      await parseFixture('actuynab-m1-savings.qif', {
        importNotes: true,
      })
    ).map(transaction => ({
      ...transaction,
      date: d.format(
        d.parse(transaction.date, 'MM/dd/yy', new Date()),
        'yyyy-MM-dd',
      ),
      amount: amountToInteger(Number(transaction.amount)),
      category: categories.get(transaction.category),
    }));
    const camt = (
      await parseFixture('actuynab-m1-checking.xml', {
        importNotes: true,
      })
    ).map(transaction => ({
      ...transaction,
      amount: amountToInteger(Number(transaction.amount)),
      category: categories.get('Travel'),
    }));

    expect(
      (await reconcileTransactions('m1-checking', csv)).added,
    ).toHaveLength(2);
    expect((await reconcileTransactions('m1-credit', ofx)).added).toHaveLength(
      2,
    );
    expect((await reconcileTransactions('m1-savings', qif)).added).toHaveLength(
      1,
    );
    expect(
      (await reconcileTransactions('m1-checking', camt)).added,
    ).toHaveLength(1);

    const countsAfterFirstImport = await Promise.all(
      ['m1-checking', 'm1-savings', 'm1-credit'].map(parentTransactionCount),
    );
    expect(
      await Promise.all(
        ['m1-checking', 'm1-savings', 'm1-credit'].map(balance),
      ),
    ).toEqual([533585, 550425, -30775]);
    expect(await combinedBalance()).toBe(beforeImport + 335485);

    for (const [account, transactions] of [
      ['m1-checking', csv],
      ['m1-credit', ofx],
      ['m1-savings', qif],
      ['m1-checking', camt],
    ] as const) {
      const result = await reconcileTransactions(account, transactions);
      expect(result.added).toEqual([]);
      expect(result.updated).toEqual([]);
    }

    expect(
      await Promise.all(
        ['m1-checking', 'm1-savings', 'm1-credit'].map(parentTransactionCount),
      ),
    ).toEqual(countsAfterFirstImport);
    expect(await combinedBalance()).toBe(beforeImport + 335485);
  }, 30000);
});
