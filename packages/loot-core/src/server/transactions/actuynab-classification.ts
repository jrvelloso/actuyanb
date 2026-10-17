import { normalizeBankPayee } from './import/actuynab-bank-import';
import { runRules } from './transaction-rules';

export type HouseholdAccountRole =
  | 'joint-checking'
  | 'credit-card'
  | 'mortgage'
  | 'vehicle-financing';

export type HouseholdAccount = {
  id: string;
  name: string;
  onBudget: boolean;
  role: HouseholdAccountRole;
  /**
   * Deliberately narrow, configured phrases that identify this account in a
   * bank description. Generic account names are not inferred automatically.
   */
  transferDescriptionTokens?: readonly string[];
};

export type HouseholdKnownPayee = {
  id: string;
  name: string;
  transferAccountId?: string | null;
};

export type ConfirmedPayeeCategory = {
  categoryId: string;
  normalizedPayee: string;
  payeeId?: string;
};

export type HistoricalCategorization = {
  amount: number;
  categoryId?: string | null;
  date: string;
  payeeName: string;
};

export type DeterministicMerchantHeuristic = {
  categoryId: string;
  normalizedPayee: string;
};

export type HouseholdClassificationInput = {
  account: string;
  amount: number;
  category?: string | null;
  cleared?: boolean;
  date: string;
  externalContribution?: boolean;
  imported_payee?: string;
  notes?: string;
  payee?: string | null;
  payee_name?: string;
  reconciled?: boolean;
  statementType?: 'card-purchase' | 'fee' | 'refund' | 'transfer' | 'unknown';
  subtransactions?: ReadonlyArray<{
    amount: number;
    category?: string;
    notes?: string;
  }>;
  transfer_id?: string;
};

export type HouseholdClassificationContext = {
  accounts: readonly HouseholdAccount[];
  confirmedPayeeCategories?: readonly ConfirmedPayeeCategory[];
  deterministicMerchantHeuristics?: readonly DeterministicMerchantHeuristic[];
  externalContributionCategoryId?: string;
  historicalTransactions?: readonly HistoricalCategorization[];
  knownPayees?: readonly HouseholdKnownPayee[];
};

export type ClassificationConfidence = 'high' | 'medium' | 'review';

export type ClassificationReason =
  | 'manual-classification-preserved'
  | 'explicit-actual-rule'
  | 'internal-transfer'
  | 'credit-card-bill-payment'
  | 'off-budget-financing-transfer'
  | 'provided-loan-split-preserved'
  | 'provided-split-preserved'
  | 'external-personal-contribution'
  | 'confirmed-payee-category'
  | 'conflicting-confirmed-mappings'
  | 'reliable-history'
  | 'conflicting-history'
  | 'recurring-pattern'
  | 'deterministic-merchant-heuristic'
  | 'manual-review';

export type ProposedPayee = {
  id?: string;
  name: string;
};

export type HouseholdClassificationResult = {
  confidence: ClassificationConfidence;
  normalizedPayee: string | null;
  proposedCategoryId: string | null;
  proposedPayee: ProposedPayee | null;
  reason: ClassificationReason;
  requiresManualReview: boolean;
  transferTargetAccountId?: string;
};

function normalizedText(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return normalizeBankPayee(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function inputPayeeName(input: HouseholdClassificationInput): string | null {
  return input.payee_name ?? input.imported_payee ?? null;
}

function payeeSuggestion(
  normalizedPayee: string | null,
  knownPayees: readonly HouseholdKnownPayee[],
  preferredPayeeId?: string | null,
): ProposedPayee | null {
  const byId = preferredPayeeId
    ? knownPayees.find(payee => payee.id === preferredPayeeId)
    : undefined;
  if (byId) {
    return { id: byId.id, name: byId.name };
  }

  if (!normalizedPayee) {
    return null;
  }

  const existing = knownPayees.find(
    payee => normalizedText(payee.name) === normalizedPayee,
  );
  if (existing) {
    return { id: existing.id, name: existing.name };
  }

  // This remains a proposal. The classifier never creates a payee.
  return { name: normalizedPayee };
}

function result({
  confidence,
  normalizedPayee,
  proposedCategoryId = null,
  proposedPayee,
  reason,
  requiresManualReview,
  transferTargetAccountId,
}: {
  confidence: ClassificationConfidence;
  normalizedPayee: string | null;
  proposedCategoryId?: string | null;
  proposedPayee: ProposedPayee | null;
  reason: ClassificationReason;
  requiresManualReview: boolean;
  transferTargetAccountId?: string;
}): HouseholdClassificationResult {
  return {
    confidence,
    normalizedPayee,
    proposedCategoryId,
    proposedPayee,
    reason,
    requiresManualReview,
    ...(transferTargetAccountId ? { transferTargetAccountId } : {}),
  };
}

function transferTarget(
  input: HouseholdClassificationInput,
  context: HouseholdClassificationContext,
  normalizedPayee: string | null,
): HouseholdAccount | null {
  const transferPayee = context.knownPayees?.find(
    payee => payee.id === input.payee && payee.transferAccountId,
  );
  if (transferPayee?.transferAccountId) {
    return (
      context.accounts.find(
        account => account.id === transferPayee.transferAccountId,
      ) ?? null
    );
  }

  if (!normalizedPayee) {
    return null;
  }

  const matchingAccounts = context.accounts.filter(account =>
    account.transferDescriptionTokens?.some(token =>
      normalizedPayee.includes(normalizedText(token)),
    ),
  );
  return matchingAccounts.length === 1 ? matchingAccounts[0] : null;
}

function hasConsistentCategory(
  transactions: readonly HistoricalCategorization[],
): string | null {
  const categories = new Set(
    transactions
      .map(transaction => transaction.categoryId)
      .filter((category): category is string => Boolean(category)),
  );
  return categories.size === 1 ? [...categories][0] : null;
}

function isMonthlyRecurring(
  transactions: readonly HistoricalCategorization[],
): boolean {
  if (transactions.length < 2) {
    return false;
  }

  const ordered = [...transactions].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  return ordered.every((transaction, index) => {
    if (index === 0) {
      return true;
    }
    const previous = new Date(`${ordered[index - 1].date}T00:00:00Z`);
    const current = new Date(`${transaction.date}T00:00:00Z`);
    const days = Math.round(
      (current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000),
    );
    return days >= 25 && days <= 35;
  });
}

/**
 * Produces an explainable household-classification preview without writing to
 * Actual's database. The only engine execution is Actual's existing rule
 * runner, preserving its user-visible rules as the highest-priority layer.
 */
export async function classifyHouseholdTransaction(
  input: HouseholdClassificationInput,
  context: HouseholdClassificationContext,
): Promise<HouseholdClassificationResult> {
  const knownPayees = context.knownPayees ?? [];
  const rawPayeeName = inputPayeeName(input);
  const normalizedPayee = rawPayeeName ? normalizedText(rawPayeeName) : null;
  const currentPayee = payeeSuggestion(
    normalizedPayee,
    knownPayees,
    input.payee,
  );

  // A category already on the transaction is a confirmed human decision. Do
  // not run rules or suggestions that could obscure it.
  if (input.category) {
    return result({
      confidence: 'high',
      normalizedPayee,
      proposedCategoryId: input.category,
      proposedPayee: currentPayee,
      reason: 'manual-classification-preserved',
      requiresManualReview: false,
    });
  }

  // Actual's rule runner is intentionally called before this layer's mappings
  // and history. We only read its payee/category output; all monetary and
  // reconciliation fields from the input remain untouched.
  const ruled = await runRules({
    ...input,
    category: null,
    payee: input.payee ?? null,
  });
  if (
    (ruled.category ?? null) !== null ||
    (ruled.payee ?? null) !== (input.payee ?? null)
  ) {
    return result({
      confidence: 'high',
      normalizedPayee,
      proposedCategoryId: ruled.category ?? null,
      proposedPayee: payeeSuggestion(normalizedPayee, knownPayees, ruled.payee),
      reason: 'explicit-actual-rule',
      requiresManualReview: !ruled.category,
    });
  }

  const target = transferTarget(input, context, normalizedPayee);
  if (target || input.transfer_id) {
    if (target?.role === 'mortgage' || target?.role === 'vehicle-financing') {
      const splitReason = input.subtransactions?.length
        ? 'provided-loan-split-preserved'
        : 'off-budget-financing-transfer';
      return result({
        confidence: 'high',
        normalizedPayee,
        proposedPayee: target ? { name: target.name } : currentPayee,
        reason: splitReason,
        requiresManualReview: false,
        transferTargetAccountId: target?.id,
      });
    }

    return result({
      confidence: 'high',
      normalizedPayee,
      proposedPayee: target ? { name: target.name } : currentPayee,
      reason:
        target?.role === 'credit-card'
          ? 'credit-card-bill-payment'
          : 'internal-transfer',
      requiresManualReview: false,
      transferTargetAccountId: target?.id,
    });
  }

  if (input.subtransactions?.length) {
    return result({
      confidence: 'high',
      normalizedPayee,
      proposedPayee: currentPayee,
      reason: 'provided-split-preserved',
      requiresManualReview: false,
    });
  }

  if (input.externalContribution && input.amount > 0) {
    return result({
      confidence: context.externalContributionCategoryId ? 'high' : 'review',
      normalizedPayee,
      proposedCategoryId: context.externalContributionCategoryId ?? null,
      proposedPayee: currentPayee,
      reason: 'external-personal-contribution',
      requiresManualReview: !context.externalContributionCategoryId,
    });
  }

  const confirmed = (context.confirmedPayeeCategories ?? []).filter(
    mapping => normalizedText(mapping.normalizedPayee) === normalizedPayee,
  );
  const confirmedCategories = new Set(
    confirmed.map(mapping => mapping.categoryId),
  );
  if (confirmedCategories.size > 1) {
    return result({
      confidence: 'review',
      normalizedPayee,
      proposedPayee: currentPayee,
      reason: 'conflicting-confirmed-mappings',
      requiresManualReview: true,
    });
  }
  if (confirmed.length === 1) {
    const mapping = confirmed[0];
    return result({
      confidence: 'high',
      normalizedPayee,
      proposedCategoryId: mapping.categoryId,
      proposedPayee: payeeSuggestion(
        normalizedPayee,
        knownPayees,
        mapping.payeeId,
      ),
      reason: 'confirmed-payee-category',
      requiresManualReview: false,
    });
  }

  const history = (context.historicalTransactions ?? []).filter(
    transaction => normalizedText(transaction.payeeName) === normalizedPayee,
  );
  const historicalCategory = hasConsistentCategory(history);
  if (history.length > 0 && !historicalCategory) {
    return result({
      confidence: 'review',
      normalizedPayee,
      proposedPayee: currentPayee,
      reason: 'conflicting-history',
      requiresManualReview: true,
    });
  }
  if (historicalCategory && history.length >= 3) {
    return result({
      confidence: 'high',
      normalizedPayee,
      proposedCategoryId: historicalCategory,
      proposedPayee: currentPayee,
      reason: 'reliable-history',
      requiresManualReview: false,
    });
  }
  if (historicalCategory && isMonthlyRecurring(history)) {
    return result({
      confidence: 'medium',
      normalizedPayee,
      proposedCategoryId: historicalCategory,
      proposedPayee: currentPayee,
      reason: 'recurring-pattern',
      requiresManualReview: false,
    });
  }

  const heuristics = (context.deterministicMerchantHeuristics ?? []).filter(
    heuristic => normalizedText(heuristic.normalizedPayee) === normalizedPayee,
  );
  const heuristicCategories = new Set(heuristics.map(item => item.categoryId));
  if (heuristicCategories.size === 1) {
    return result({
      confidence: 'medium',
      normalizedPayee,
      proposedCategoryId: heuristics[0].categoryId,
      proposedPayee: currentPayee,
      reason: 'deterministic-merchant-heuristic',
      requiresManualReview: false,
    });
  }

  return result({
    confidence: 'review',
    normalizedPayee,
    proposedPayee: currentPayee,
    reason: 'manual-review',
    requiresManualReview: true,
  });
}
