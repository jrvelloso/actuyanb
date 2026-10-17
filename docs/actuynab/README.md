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

## Project documents

- [Architecture](architecture.md) — package boundaries, extension seams, and
  integrity constraints.
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

## Working agreement

Use a feature branch for ActuYNAB changes and keep commits focused. Fetch and
compare `upstream/master` before any upstream merge; resolve conflicts with the
customization boundaries above in mind. The repository's existing `AGENTS.md`
and PR rules remain authoritative for coding, tests, and contribution workflow.
