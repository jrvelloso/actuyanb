import type { HouseholdClassificationContext } from './actuynab-classification';

/** Fictional shared-household data. Amounts are integer minor units. */
export const syntheticHouseholdClassificationFixture: HouseholdClassificationContext =
  {
    accounts: [
      {
        id: 'activo-joint',
        name: 'Activo',
        onBudget: true,
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA ACTIVO'],
      },
      {
        id: 'millenium-joint',
        name: 'Millenium',
        onBudget: true,
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA MILLENIUM'],
      },
      {
        id: 'cc-activo-classic',
        name: 'CC-Activo-Classic',
        onBudget: true,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC ACTIVO CLASSIC'],
      },
      {
        id: 'cc-millenium-gold',
        name: 'CC-Millenium-Gold',
        onBudget: true,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC MILLENIUM GOLD'],
      },
      {
        id: 'cc-millenium-classic',
        name: 'CC-Millenium-Classic',
        onBudget: true,
        role: 'credit-card',
        transferDescriptionTokens: ['PAGAMENTO CC MILLENIUM CLASSIC'],
      },
      {
        id: 'tesla-financing',
        name: 'Tesla',
        onBudget: false,
        role: 'vehicle-financing',
        transferDescriptionTokens: ['PAGAMENTO TESLA FINANCIAMENTO'],
      },
      {
        id: 'home-mortgage',
        name: 'Home',
        onBudget: false,
        role: 'mortgage',
        transferDescriptionTokens: ['PRESTACAO CASA HOME'],
      },
    ],
    confirmedPayeeCategories: [
      {
        categoryId: 'cat-groceries',
        normalizedPayee: 'Continente',
        payeeId: 'payee-continente',
      },
    ],
    deterministicMerchantHeuristics: [
      {
        categoryId: 'cat-groceries',
        normalizedPayee: 'Pingo Doce',
      },
    ],
    externalContributionCategoryId: 'cat-household-contributions',
    historicalTransactions: [
      {
        amount: -2399,
        categoryId: 'cat-health',
        date: '2026-01-12',
        payeeName: 'Farmacia Ficticia',
      },
      {
        amount: -1999,
        categoryId: 'cat-health',
        date: '2026-02-10',
        payeeName: 'Farmacia Ficticia',
      },
      {
        amount: -2999,
        categoryId: 'cat-health',
        date: '2026-03-11',
        payeeName: 'Farmacia Ficticia',
      },
      {
        amount: -4500,
        categoryId: 'cat-utilities',
        date: '2026-01-03',
        payeeName: 'Fibra Casa',
      },
      {
        amount: -4500,
        categoryId: 'cat-utilities',
        date: '2026-02-03',
        payeeName: 'Fibra Casa',
      },
    ],
    knownPayees: [
      { id: 'payee-continente', name: 'Continente' },
      { id: 'payee-farmacia', name: 'Farmacia Ficticia' },
      { id: 'payee-fibra', name: 'Fibra Casa' },
      { id: 'payee-pingo', name: 'Pingo Doce' },
    ],
  };
