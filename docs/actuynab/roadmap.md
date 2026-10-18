# ActuYNAB roadmap

This roadmap is ordered by financial safety and existing extension points. It
is a structured backlog, not a promise of dates.

## M0 — repository discovery and baseline — complete

- Fork cloned with `origin` and `upstream` remotes; work is on
  `docs/milestone-0-baseline`.
- Development toolchain installed immutably and baseline package structure,
  importers, migration, rule engine, sync, security, deployment, and backups
  inspected.
- Project architecture, roadmap, operating model, migration plan, import plan,
  and categorization plan added under `docs/actuynab/`.
- Full typecheck passes. Test and lint baseline caveats are recorded in the
  Milestone 0 delivery notes rather than hidden by unrelated changes.

## M1 — functional baseline

**Goal:** establish a reproducible local and private test deployment before
changing financial behaviour.

1. Launch a synthetic demo budget in browser and test accounts, transfers,
   splits, scheduled transactions, reconciliation, budgeting, and reports.
2. Exercise CSV, OFX/QFX, and CAMT imports twice against fixtures and record
   expected duplicate behavior.
3. Add a private Docker Compose deployment guide with HTTPS/reverse-proxy
   choices, persistent-volume paths, smoke checks, and backup/restore drills.
4. Resolve or isolate the Windows test-cleanup baseline so CI is reliable.

**Exit criteria:** a new contributor can run a synthetic demo, import fixtures
idempotently, and recover a private test deployment from a backup.

## M2 — YNAB 4 migration assurance

**Goal:** make existing migration observable and safe before adding behaviour.

1. Add synthetic source fixtures covering accounts, transfers, splits, notes,
   categories, schedules, and monthly budgets.
2. Produce a post-import validation report with source/destination account
   balances, transaction counts, transfer/split counts, and explicit gaps.
3. Improve the split-payee repair path and evaluate import of YNAB 4 payee
   rules and scheduled transactions.
4. Add regression tests for repeatability and failures without source mutation.

## M3 — statement import automation

**Goal:** make recurring Portuguese-bank statement imports safe and reviewable.

1. Define the importer-adapter contract and import-batch audit model.
2. Add fixture-led support for the first nominated Portuguese bank and its
   export format; include European dates, decimal commas, EUR, encoding, and
   statement identifiers.
3. Preserve imported IDs, improve deterministic fallback matching, and surface
   ambiguous duplicates and transfer candidates for confirmation.
4. Build an import preview/history and review queue, then repeat per bank.

## M4 — intelligent categorization

**Goal:** improve automation using explainable, deterministic signals first.

1. Make rule and learned-category provenance visible on a transaction.
2. Add normalized-payee aliases and historical matching with conservative,
   testable confidence thresholds.
3. Add a review queue for low-confidence suggestions and feed corrections back
   into user-visible rules/associations.
4. Evaluate local or expressly opted-in AI suggestions only after the
   deterministic flow is complete.

## M5 — ActuYNAB experience

**Goal:** add an automation dashboard and incremental identity improvements.

1. Create the automation dashboard for imports, uncategorized rows,
   duplicates, transfer suggestions, rules, errors, and processing history.
2. Improve desktop/mobile workflow friction using existing design tokens and
   component primitives.
3. Add ActuYNAB branding only where it does not make upstream merge conflict
   resolution expensive; preserve Portuguese and English translations.

## M6 — secure online operation

**Goal:** validate a private, supportable self-hosted service.

1. Verify HTTPS, authentication, sync recovery, access controls, persistent
   storage, backup/restore, and routine upgrades in a test environment.
2. Review logs and operational configuration for financial-data exposure.
3. Run focused financial, import, sync, and security regressions before any
   production deployment approval.

## Deferred evaluation

Open Banking/PSD2 automation, shared-household budgeting, advanced forecasts,
PWA capabilities, and a SaaS offering remain discovery items. Each requires a
separate decision covering consent, provider cost, regulation, privacy,
security, and support burden before implementation.
