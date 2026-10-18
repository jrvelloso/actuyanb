import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import type { HouseholdDashboard } from '@actual-app/core/server/transactions/actuynab-dashboard';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TestProviders } from '#mocks';
import { pushModal } from '#modals/modalsSlice';

import { DailyBudget, ImportReviewQueue } from './HouseholdDailyBudget';

const mockDispatch = vi.fn();
const mockNavigate = vi.fn();

vi.mock('#hooks/useFormat', () => ({
  useFormat: () => (value: number) => String(value),
}));

vi.mock('#hooks/useNavigate', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('#redux', async importOriginal => ({
  ...(await importOriginal()),
  useDispatch: () => mockDispatch,
}));

const dailyBudget: HouseholdDashboard['dailyBudget'] = {
  categories: [
    {
      balance: -1_000,
      budgeted: 5_000,
      carriesOver: false,
      categoryId: 'dining',
      categoryName: 'Dining out',
      groupName: 'Everyday',
      spent: 6_000,
    },
    {
      balance: 3_000,
      budgeted: 12_000,
      carriesOver: true,
      categoryId: 'groceries',
      categoryName: 'Groceries',
      groupName: 'Everyday',
      spent: 9_000,
    },
  ],
  hasBudgetData: true,
  remaining: 2_000,
};

function renderWithProviders(children: ReactNode) {
  return render(
    <TestProviders>
      <MemoryRouter>{children}</MemoryRouter>
    </TestProviders>,
  );
}

describe('Household daily budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('surfaces native overspending and opens the selected category activity', async () => {
    const user = userEvent.setup();
    const onOpenBudget = vi.fn();
    renderWithProviders(
      <DailyBudget
        dailyBudget={dailyBudget}
        month="2026-10"
        monthly={{
          actualSpending: 15_000,
          budgetedSpending: 17_000,
          hasBudgetedSpending: true,
          income: 30_000,
        }}
        onOpenBudget={onOpenBudget}
      />,
    );

    expect(screen.getByText('Categories needing attention')).toBeVisible();
    expect(screen.getByText(/Overspent/)).toBeVisible();
    expect(
      screen.getByText("This category uses Actual's native carryover setting."),
    ).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'View Dining out activity' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      '/accounts',
      expect.objectContaining({
        state: expect.objectContaining({ categoryId: 'dining' }),
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Open full budget' }));
    expect(onOpenBudget).toHaveBeenCalledOnce();
  });

  test('opens the established M5 review modal instead of applying a suggestion', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ImportReviewQueue
        reviews={[
          {
            accountId: 'activo-account',
            accountName: 'Activo',
            batchId: 'batch-1',
            createdAt: '2026-10-18T00:00:00.000Z',
            creditCardPaymentCount: 1,
            itemCount: 2,
            manualReviewCount: 1,
            sourceBank: 'activobank',
            sourceFormat: 'xlsx',
            transferCount: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText(/item requires manual attention\./)).toBeVisible();
    expect(
      screen.getByText(/credit-card payment is protected from new spending\./),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Open review' }));
    expect(mockDispatch).toHaveBeenCalledWith(
      pushModal({
        modal: {
          name: 'actuynab-import-review',
          options: { accountId: 'activo-account', batchId: 'batch-1' },
        },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'View account' }));
    expect(mockNavigate).toHaveBeenCalledWith('/accounts/activo-account');
  });
});
