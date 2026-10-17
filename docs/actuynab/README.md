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

## Project documents

- [Architecture](architecture.md) — package boundaries, extension seams, and
  integrity constraints.
- [Roadmap](roadmap.md) — ordered, evidence-based milestones and backlog.
- [YNAB 4 migration](ynab4-migration.md) — supported data, known gaps, and the
  validation-report design.
- [Bank statement imports](bank-imports.md) — Portuguese-bank extension model,
  idempotency, and review flow.
- [Categorization](categorization.md) — deterministic decision order and future
  opt-in AI boundary.
- [Operations](operations.md) — private Docker deployment, HTTPS, backups, and
  recovery verification.

- [Functional validation](validation.md) â€” Windows setup, synthetic data,
  repeatable import/backup procedures, and results.

## Working agreement

Use a feature branch for ActuYNAB changes and keep commits focused. Fetch and
compare `upstream/master` before any upstream merge; resolve conflicts with the
customization boundaries above in mind. The repository's existing `AGENTS.md`
and PR rules remain authoritative for coding, tests, and contribution workflow.
