import * as budget from '#server/budget/base';
import * as db from '#server/db';
import { handlers } from '#server/main';
import { runHandler } from '#server/mutators';
import * as sheet from '#server/sheet';
import { clearUndo } from '#server/undo';
import * as monthUtils from '#shared/months';

beforeEach(async () => {
  await global.emptyDatabase()();
  clearUndo();
});

describe('ActuYNAB Milestone 14 multi-month budget grid', () => {
  test('reads three native month sheets and edits one allocation through the undoable budget handler', async () => {
    await sheet.loadSpreadsheet(db);
    await db.insertCategoryGroup({ id: 'expenses', name: 'Expenses' });
    await db.insertCategoryGroup({
      id: 'income',
      is_income: 1,
      name: 'Income',
    });
    const groceries = await db.insertCategory({
      id: 'groceries',
      cat_group: 'expenses',
      name: 'Groceries',
    });
    await db.insertAccount({ id: 'checking', name: 'Synthetic checking' });
    await db.insertAccount({ id: 'credit-card', name: 'Synthetic card' });
    await db.insertAccount({
      id: 'home',
      name: 'Synthetic home liability',
      offbudget: 1,
    });

    await db.insertTransaction({
      account: 'checking',
      amount: -8_000,
      category: groceries,
      date: '2017-01-05',
      id: 'synthetic-jan-groceries',
    });
    await db.insertTransaction({
      account: 'credit-card',
      amount: -3_000,
      category: groceries,
      date: '2017-02-07',
      id: 'synthetic-feb-card-purchase',
    });
    await db.insertTransaction({
      account: 'checking',
      amount: -3_000,
      date: '2017-02-08',
      id: 'synthetic-feb-card-payment',
    });
    await db.insertTransaction({
      account: 'credit-card',
      amount: 3_000,
      date: '2017-02-08',
      id: 'synthetic-feb-card-payment-counterpart',
    });
    await db.insertTransaction({
      account: 'home',
      amount: -2_000,
      category: groceries,
      date: '2017-03-09',
      id: 'synthetic-mar-offbudget-movement',
    });

    await budget.createAllBudgets();
    await sheet.waitOnSpreadsheet();

    await runHandler(handlers['budget/set-carryover'], {
      category: groceries,
      flag: true,
      startMonth: '2017-01',
    });
    await runHandler(handlers['budget/budget-amount'], {
      amount: 10_000,
      category: groceries,
      month: '2017-01',
    });
    await runHandler(handlers['budget/budget-amount'], {
      amount: 5_000,
      category: groceries,
      month: '2017-02',
    });
    await runHandler(handlers['budget/budget-amount'], {
      amount: 7_000,
      category: groceries,
      month: '2017-03',
    });
    await sheet.waitOnSpreadsheet();

    const january = monthUtils.sheetForMonth('2017-01');
    const february = monthUtils.sheetForMonth('2017-02');
    const march = monthUtils.sheetForMonth('2017-03');

    expect(sheet.getCellValue(january, `budget-${groceries}`)).toBe(10_000);
    expect(sheet.getCellValue(january, `sum-amount-${groceries}`)).toBe(-8_000);
    expect(sheet.getCellValue(january, `leftover-${groceries}`)).toBe(2_000);
    expect(sheet.getCellValue(february, `budget-${groceries}`)).toBe(5_000);
    expect(sheet.getCellValue(february, `sum-amount-${groceries}`)).toBe(
      -3_000,
    );
    expect(sheet.getCellValue(february, `leftover-${groceries}`)).toBe(4_000);
    expect(sheet.getCellValue(march, `budget-${groceries}`)).toBe(7_000);
    expect(sheet.getCellValue(march, `sum-amount-${groceries}`)).toBe(0);
    expect(sheet.getCellValue(march, `leftover-${groceries}`)).toBe(11_000);

    clearUndo();
    await runHandler(handlers['budget/budget-amount'], {
      amount: 6_000,
      category: groceries,
      month: '2017-02',
    });
    await sheet.waitOnSpreadsheet();
    expect(sheet.getCellValue(february, `budget-${groceries}`)).toBe(6_000);
    expect(sheet.getCellValue(march, `leftover-${groceries}`)).toBe(12_000);

    await runHandler(handlers.undo);
    await sheet.waitOnSpreadsheet();
    expect(sheet.getCellValue(february, `budget-${groceries}`)).toBe(5_000);
    expect(sheet.getCellValue(march, `leftover-${groceries}`)).toBe(11_000);

    await runHandler(handlers.redo);
    await sheet.waitOnSpreadsheet();
    expect(sheet.getCellValue(february, `budget-${groceries}`)).toBe(6_000);
    expect(sheet.getCellValue(march, `leftover-${groceries}`)).toBe(12_000);
  });
});
