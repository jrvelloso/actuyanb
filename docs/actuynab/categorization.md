# Categorization strategy

Actual already has a transparent rules engine. Imported transactions retain the
original `imported_payee`; rules run in ordered `pre`, default, and `post`
stages. It can learn a payee-to-category rule from recent categorized activity,
and users can inspect, edit, disable, or override these rules.

ActuYNAB extends that model; it does not replace it with an opaque classifier.

## Decision order

1. An explicit, enabled user rule.
2. A confirmed normalized-payee/category association.
3. A sufficiently consistent historical match for the same normalized payee.
4. Deterministic bank- or text-specific heuristics.
5. An optional AI suggestion, only after explicit configuration and consent.
6. A manual-review queue when confidence is inadequate or signals conflict.

Every automatic outcome must state its source, such as “Rule: Continente”,
“Confirmed association”, or “History: 8 of last 9 transactions”. This makes a
description such as `PAG CARTAO CONTINENTE MONTIJO 123456` explainable: an
adapter/rule can normalize it to a visible payee candidate, then the ordinary
rules and learning system can set the category.

## Confidence and correction

Confidence is a deterministic policy value, not a financial calculation. It is
derived from signals such as exact rule match, stable identifier, normalized
payee match, historical count/ratio, amount/date patterns, and conflicts. The
initial policy should be conservative:

- automatically apply explicit rules and strong confirmed associations;
- present medium-confidence matches as editable suggestions;
- queue low-confidence or conflicting suggestions for review;
- let a user correction create or update a visible rule/association only with
  their chosen scope.

This preserves the user's ability to see, edit, disable, and reverse learned
behaviour.

## Data and privacy boundaries

- Keep original imported descriptions for existing rule behavior and audit
  explanations, applying normal data-protection practices.
- Store aliases, rules, provenance, and confidence in additive, synchronized
  records only after a schema/API review.
- Do not send transaction descriptions, balances, or derived profiles to an
  external model by default.
- Any future AI integration needs separate user consent, provider/data-flow
  documentation, opt-out, retention policy, and a guarantee that it can only
  suggest—not write—financial data without user confirmation.

## First implementation tasks

1. Inventory the existing automatic category-learning behavior with tests.
2. Add normalized-payee aliases and source/explanation metadata without
   changing rule precedence.
3. Define and test confidence thresholds against synthetic transaction history.
4. Build a review queue that uses existing transaction edits/rules for the
   final action.
