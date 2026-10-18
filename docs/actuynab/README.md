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

## Working agreement

Use a feature branch for ActuYNAB changes and keep commits focused. Fetch and
compare `upstream/master` before any upstream merge; resolve conflicts with the
customization boundaries above in mind. The repository's existing `AGENTS.md`
and PR rules remain authoritative for coding, tests, and contribution workflow.
