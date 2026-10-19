# ActuYNAB

ActuYNAB is a private, local-first personal-finance application built as a
maintained fork of [Actual Budget](https://github.com/actualbudget/actual). It
keeps Actual's deterministic envelope budgeting and synchronization model while
adding a pragmatic path to YNAB 4 migration and low-touch Portuguese-bank
statement processing.

## Project boundaries

- Actual Budget remains the product foundation. Custom behaviour should use
  narrow extension points and avoid changes to core budgeting calculations.
- Financial data is private. Development uses only synthetic data; credentials
  and real statements never enter source control.
- The accounting model continues to use Actual's integer money representation.
  AI never calculates, writes, or silently changes financial values.
- A change that can affect balances, reconciliation, imports, transfers, split
  transactions, or cross-month budgets needs regression coverage.

## Milestone 0 baseline

Discovery was completed against Actual commit `8d59f30cfb36b177882116e0bd0dae39e30d2751` on 2026-10-17. The fork's `master` points
to that same commit at this baseline.

The project is a Yarn 4 workspaces monorepo using TypeScript, React, Vite,
SQLite, Vitest, Playwright, and Lage. The local environment is Node 24.12.0 and
Yarn 4.17.1.

Actual already supplies the essential foundations:

- envelope budgets, accounts, reconciliation, transfers, splits, schedules,
  reports, and synchronized budgets;
- CSV, QIF, OFX, QFX, and CAMT imports with a preview/configuration workflow;
- duplicate avoidance based first on an imported ID and then a
  date/amount/payee match;
- an ordered transaction-rules engine with automatic payee and category learning;
- YNAB 4 import, existing bank-sync providers, Docker deployment, authentication,
  and backup/export support.

The remaining work is therefore targeted extension and validation, not a
rewrite. See the linked documents for the technical plan.

## Milestone 1 functional baseline

Milestone 1 adds a repeatable, entirely synthetic validation path for the
existing financial core. It exercises multi-account historical data,
categories, a recurring schedule, split transactions, an internal transfer,
CSV/OFX/QIF/CAMT statement imports, repeated-import idempotency, and
backup/restore. The tests do not require network access, bank credentials, or
real financial data.

The Windows 11 setup and evidence from the validation run are recorded in
[Functional validation](validation.md). The provider-specific status for
ActivoBank and Revolut is in [Bank statement imports](bank-imports.md).

## Milestone 2 migration assurance

Milestone 2 adds a synthetic YNAB 4 archive and an isolated-destination
validation harness. It verifies account balances, transaction amounts and
counts, transfers, splits, category/payee mappings, allocations and rollover,
and reconciliation states, then produces JSON or Markdown reports. Confirmed
model differences—scheduled transactions, YNAB payee rules, account types,
and reconciliation checkpoints—are explicit report entries rather than
hidden migration losses. See [YNAB 4 migration](ynab4-migration.md).

## Milestone 3 bank-import automation

Milestone 3 adds a deliberately narrow bank-statement preparation layer for
synthetic ActivoBank-style and Revolut-style CSV fixtures. It normalizes
European dates and amounts, source identities, pending/booked transactions,
refunds, explicit fees, and disclosed settlement amounts before delegating to
Actual's established reconciliation flow. Repeated and overlapping files are
financially idempotent, ambiguous fallback matches require review, and transfer
references produce suggestions rather than automatic account links. Each run
returns a non-sensitive Markdown or JSON audit record; the scope does not add
real bank connectivity, credential handling, source-file persistence, or a new
interface. See [Bank statement imports](bank-imports.md).

## Milestone 4 intelligent categorization

Milestone 4 adds a deterministic, side-effect-free classification preview for
the synthetic shared household. It runs Actual rules first, then confirmed
payee/category mappings, conflict-free history, recurring patterns, and narrow
merchant heuristics. It returns a proposed payee/category, named reason,
qualitative confidence, and review requirement without changing a budget.
Transfers, credit-card bill payments, mortgage and vehicle-financing payments,
manual corrections, refunds, and provided splits have explicit safe handling.
See [Categorization](categorization.md).

## Milestone 5 synced import review

Milestone 5 provides the first user-visible automation loop. Actual's existing
import preview and reconciler select financial transactions; the new review
modal then shows deterministic payee/category suggestions, reasons,
qualitative confidence, potential duplicates, transfer safeguards, and manual
attention. Only explicit approval or correction applies existing payee/category
IDs. Additive synced audit, queue, and decision records survive reloads and
participate in Actual's normal CRDT synchronization; raw bank files are never
stored. See [Synced import review](import-review.md).

## Milestone 6 deployment readiness

Milestone 6 combines the sibling Vercel PoC and synced-review work on an
integration branch without changing their existing pull requests. It adds a
private Docker/Caddy deployment baseline, a production-bundle browser test,
and a synthetic two-client sync, restart, and isolated restore drill. The
private environment is ready for an owner-controlled remote-host exercise; it
is not a production deployment. See [Deployment readiness](deployment-readiness.md).

## Milestone 7 household budget experience

Milestone 7 adds a configurable, synced shared-household setup and a focused
Household overview. It maps account roles to Actual account IDs rather than
hardcoding account names, optionally applies an idempotent starter category
template, and separates budget availability, checking balances, card and
financing liabilities, monthly categorized spending, pending reviews, and
upcoming schedules. It preserves Actual's transfer, card, split,
reconciliation, and off-budget tracking semantics. See [Household budget
experience](household-budget.md).

## Milestone 8 ActivoBank XLSX import

Milestone 8 adds a structurally detected, single-sheet ActivoBank Portugal
XLSX statement adapter. It preserves booking and value dates, signed EUR minor
units, descriptions, balance-validation warnings, and Actual's duplicate
reconciliation semantics. The file enters the existing M3 preparation, M4
classification, M5 review/confirmation, and M7 household-protection path; it
does not store the workbook or create a second financial database. Synthetic
XLSX/browser tests prove repeat imports create no transactions and an explicit
review correction persists across a local sync-server restart. See [Bank
statement imports](bank-imports.md) and [Functional validation](validation.md).

## Milestone 10 financing management

Milestone 10 adds a Household financing-management view for the existing Home
and Tesla off-budget tracking accounts. It displays actual ledger balances and
user-verified payment metadata separately. A confirmed allocation can link a
checking payment/refund to an existing principal movement and optional separate
insurance charge, but it cannot create or edit a financial transaction, change
a reconciliation state, or infer a loan schedule. The additive synced metadata
is validated against the referenced ledger values, stays idempotent on repeat
save, and is excluded from spending/liability totals. See [Financing
management](financing-management.md).

## Milestone 11 financial dashboard

Milestone 11 adds a read-only monthly dashboard within Household. It uses
Actual's budget sheet and categorized ledger values for availability,
income/spending, budgeted-versus-actual spending, and six-month trends; it
shows configured account balances and M5 pending reviews without treating
liabilities as spendable cash. Home/Tesla balances remain observed tracking
ledger values, while principal, interest, and insurance are M10's verified
manual metadata for the selected month and are never added to an expense or
liability total. See [Financial dashboard](financial-dashboard.md).

## Milestone 12 daily budget experience

Milestone 12 extends the M11 Household dashboard with native category budget
cells, overspending and carryover visibility, category-month drill-downs, and
direct access to the existing M5 import-review modal. It reuses Actual's local
budget-month preference and formatting settings, and remains read-only until a
user explicitly confirms work in the established review interface. See [Daily
budget experience](daily-budget-experience.md).

## Milestone 13 YNAB 4-inspired experience

Milestone 13 makes the sidebar account-centred while retaining Actual's
native account and navigation behavior. It adds an explicit, no-write
Household setup preview and an optional, idempotent personal category template
whose records are matched within their group. The dashboard and current
budgeting views remain read-only: a writable multi-month grid is documented as
a follow-up because it must reuse Actual's budget-sheet mutation and undo
paths. See [YNAB 4-inspired experience](ynab4-experience.md).

## Milestone 14 multi-month budget grid

Milestone 14 adds an opt-in, local three-month envelope-budget grid on top of
Actual's native sheet values and existing editable budget cells. It preserves
category order/collapse state, native available-to-budget, carryover and
overspending calculations, undo/redo, and CRDT persistence without adding a
second financial model. On narrow screens the category column remains sticky
while month columns scroll. See [Multi-month budget grid](multi-month-budget.md).

## Milestone 15 visual identity foundation

Milestone 15 establishes the shared semantic theme layer used by the desktop
client and component library. It gives the existing light, dark, and midnight
theme paths a consistent ActuYNAB palette, visible keyboard focus, compact
sidebar selection, and table-friendly financial status colours. It does not
alter a budget cell, financial calculation, local preference, sync record, or
logo asset. See [Visual identity foundation](visual-identity.md).

## Project documents

- [Architecture](architecture.md) — package boundaries, extension seams, and
  integrity constraints.
- [Integration hygiene and CI readiness](integration-readiness.md) — safe
  merge order, cross-platform validation, CI security controls, and the
  recommended `master` protection baseline.
- [Roadmap](roadmap.md) — ordered, evidence-based milestones and backlog.
- [YNAB 4 migration](ynab4-migration.md) — supported data, known gaps, and the
  validation-report design.
- [Bank statement imports](bank-imports.md) — Portuguese-bank extension model,
  idempotency, and review flow.
- [Categorization](categorization.md) — deterministic decision order,
  household safeguards, and preview contract.
- [Operations](operations.md) — private Docker deployment, HTTPS, backups, and
  recovery verification.
- [Vercel frontend proof of concept](vercel-deployment.md) — static frontend
  boundary, external-sync requirement, safe rollout steps, and hosting tradeoffs.

- [Functional validation](validation.md) â€” Windows setup, synthetic data,
  repeatable import/backup procedures, and results.

- [Synced import review](import-review.md) — confirmation workflow, synced
  audit data, safeguards, validation, and current limitations.

- [Deployment readiness](deployment-readiness.md) — integration plan, private
  Docker baseline, Vercel preview settings, browser/sync evidence, and gates.

- [Household budget experience](household-budget.md) — configurable shared
  accounts, category template, financing safeguards, overview semantics, and
  synthetic validation.

- [Windows local Docker development](local-docker-development.md) —
  localhost-only native sync server, React hot reload, synthetic Household
  validation, and safe local backup/restore steps.

- [Financing management](financing-management.md) - verified installment
  allocations, reconciliation safeguards, dashboard semantics, and limits.

- [Financial dashboard](financial-dashboard.md) - selected-month household
  projection, sources, drill-downs, safeguards, and synthetic validation.

- [Daily budget experience](daily-budget-experience.md) - native category
  balances, daily review navigation, preferences, safeguards, and validation.

- [YNAB 4-inspired experience](ynab4-experience.md) - account-centred
  navigation, safe personal setup, category choices, and deferred
  multi-month-budget design.

- [Multi-month budget grid](multi-month-budget.md) - opt-in native
  three-month envelope budget, editing path, financial semantics, and
  validation.

- [Visual identity foundation](visual-identity.md) - semantic tokens, theme
  behaviour, manual review, and deferred refinements.

## Working agreement

Use a feature branch for ActuYNAB changes and keep commits focused. Fetch and
compare `upstream/master` before any upstream merge; resolve conflicts with the
customization boundaries above in mind. The repository's existing `AGENTS.md`
and PR rules remain authoritative for coding, tests, and contribution workflow.
