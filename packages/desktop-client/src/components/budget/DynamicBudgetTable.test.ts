import { getBudgetMonthLayout, YNAB4_GRID_MONTHS } from './DynamicBudgetTable';

describe('YNAB 4 multi-month budget layout', () => {
  test('keeps three native month columns on a wide viewport', () => {
    expect(
      getBudgetMonthLayout({
        width: 1_800,
        categoryWidth: 200,
        maxMonths: 1,
        isMultiMonthGrid: true,
      }),
    ).toEqual({
      minWidth: 1_700,
      numMonths: YNAB4_GRID_MONTHS,
      numPossible: 6,
      requiresHorizontalScroll: false,
    });
  });

  test('keeps the same three-month grid and requires horizontal scrolling when narrow', () => {
    expect(
      getBudgetMonthLayout({
        width: 900,
        categoryWidth: 200,
        maxMonths: 6,
        isMultiMonthGrid: true,
      }),
    ).toMatchObject({
      minWidth: 1_700,
      numMonths: YNAB4_GRID_MONTHS,
      requiresHorizontalScroll: true,
    });
  });

  test("retains Actual's responsive month count when the preference is off", () => {
    expect(
      getBudgetMonthLayout({
        width: 900,
        categoryWidth: 200,
        maxMonths: 6,
        isMultiMonthGrid: false,
      }),
    ).toMatchObject({
      minWidth: 1_200,
      numMonths: 2,
      requiresHorizontalScroll: false,
    });
  });
});
