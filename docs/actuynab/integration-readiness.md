# Integration hygiene and CI readiness

This runbook records the M0–M8 integration baseline. It contains only
synthetic-fixture evidence. Do not attach a real budget, statement, account
identifier, password, recovery key, or server database to a pull request,
workflow artifact, log, or test run.

## Baseline and branch topology

The complete functional baseline is the head of PR #11. Its ancestry includes
PRs #1–#5 and #7–#11. PR #6 is intentionally still open: it is a sibling of
the M5 work, and its Vercel proof-of-concept commits were incorporated by the
M6 integration branch. It must not be closed or merged as a duplicate.

The safe merge sequence is deliberately ordered:

1. Merge #1 into `master` with a **merge commit**.
2. Retarget #2 to `master`, verify its required checks, and merge it with a
   merge commit.
3. Repeat the retarget, verification, and merge-commit process for #3, #4,
   and #5.
4. Leave #6 open and do not retarget it.
5. Retarget and merge #7, #8, #9, #10, and #11 in that order, always against
   the newly advanced `master`.
6. Retarget this integration-hygiene PR from the M8 branch to `master` only
   after #11 has merged, rerun its required checks, and merge it last.

Do not squash or rebase this dependency chain: merge commits preserve the
reviewed parentage and make a rollback of one milestone auditable. Do not
delete source branches until a human has verified the resulting `master`.

## Windows 11 shell and line endings

The browser build and some root scripts invoke POSIX-shell scripts. In
PowerShell, Git for Windows must provide `sh.exe`; Windows' WSL launcher or a
different `bash.exe` is not a substitute when its WSL distribution is absent.

```powershell
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
Get-Command sh
yarn install --immutable
```

`Get-Command sh` must report `C:\Program Files\Git\usr\bin\sh.exe`. Put that
directory in the user or system `PATH` for a permanent setup, then open a new
terminal. Git Bash already satisfies the requirement.

`.gitattributes` now checks out all text files as LF, with explicit binary and
Android `.bat` exceptions. This prevents Windows CRLF checkouts from making
the formatter report unrelated files. Preserve local work before taking a new
checkout or worktree that uses this rule; do not run a repository-wide
formatter or `git add --renormalize` to repair an existing dirty checkout.

## Required local validation

Run these from the repository root after the Git-for-Windows `sh` setup:

```powershell
yarn constraints
yarn check:tsconfig-references
yarn lint
yarn typecheck
yarn test
yarn build:browser --skip-translations
yarn build:api
yarn workspace @actual-app/sync-server build
yarn workspace @actual-app/ci-actions tsx bin/check-migrations.ts

$env:E2E_USE_BUILD = '1'
$env:E2E_PORT = '3011'
yarn workspace @actual-app/web e2e e2e/deployment-readiness.test.ts
```

The Playwright production-bundle server uses the workspace's existing
`cross-env` dependency, so setting `E2E_USE_BUILD=1` works on Windows and
Linux. It continues to serve with the required COOP/COEP headers; it does not
replace Actual's development server or sync server.

Focused financial regression should include the M1–M8 import, migration,
review, household, sync, and XLSX suites before every integration decision.
No validation command may point at a real financial source.

### Recorded pre-integration results

On Windows 11 with Node 24.12.0 and Yarn 4.17.1, the focused M0–M8 and
migration/sync regression set passed: **12 files, 126 tests**. The production
browser bundle, API build, direct sync-server build, root typecheck,
constraints, and TypeScript project-reference check also passed. The
production-bundle Chromium deployment-readiness smoke test passed when given
an already running correctly headed server.

The complete `yarn test` baseline produced **1,323 passing tests, 2 skipped,
and 2 failures**. Both failures are the existing Node 24 Windows-1252 parser
expectations in `parse-file.test.ts` (`handles windows-1252 charset` and
`csv import accepts iso-8859-1 as a windows-1252 alias`). They decode `0x80`
and `0x97` as controls rather than a Euro sign and em dash. This is a
cross-runtime issue, not an approved exception: do not alter snapshots or
silently ignore new failures. See [Functional validation](validation.md) for
the detailed evidence.

Before this line-ending correction, root browser-build and migration-check
commands on this workstation selected an unavailable WSL `bash.exe`. Re-run
them with Git's `sh.exe` first on `PATH`; Linux CI is not affected.

A fresh LF worktree reduces the formatter report from 503 files to three
existing ActuYNAB Markdown tables (`architecture.md`,
`deployment-readiness.md`, and `household-budget.md`). Their localized table
alignment fixes are included with this change; a second clean-worktree run
passes all 2,699 formatter inputs. Do not mass-reformat the repository to hide
the original Windows checkout problem.

## CI validation and data handling

The existing Linux workflows already cover the core integration surface:

| Workflow           | Required coverage                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `Test`             | constraints, project references, lint/format, typecheck, unit and integration tests, migration check |
| `Build`            | API, CRDT, browser, CLI, and sync-server builds                                                      |
| `E2E Tests`        | Chromium functional and visual-regression shards; desktop E2E                                        |
| `API Browser Test` | API browser integration when relevant packages change                                                |
| `CodeQL`           | JavaScript security analysis                                                                         |
| `Secret Scan`      | pinned Gitleaks scan of pull requests and `master` pushes                                            |

`Secret Scan` deliberately has only `contents: read`, disables pull-request
comments, and does not upload a SARIF or scan artifact. A failed job supplies
the required signal without retaining a possible secret or financial-looking
fixture outside the checkout. Resolve any finding by revoking/rotating a real
secret; removing it only from a later commit does not make historic exposure
safe. Run a full-history scan manually through `workflow_dispatch` before a
release or when an external history import is contemplated.

Existing build and E2E artifacts are allowed only for synthetic fixtures and
are not a channel for budgets, statements, credentials, backups, or server
data. Do not loosen this policy to diagnose a CI failure.

### GitHub-hosted runner policy

ActuYNAB does not have access to Actual Budget's Depot runner tenancy. All
workflows therefore use GitHub-hosted labels: `ubuntu-latest`,
`ubuntu-24.04`, `ubuntu-22.04`, `windows-2022`, or `macos-latest`. The
standard public Linux runner provides four vCPUs and 16 GB RAM; it is the
baseline for the financial regression, build, migration, secret-scan, and
Chromium jobs. Do not introduce a larger runner unless a failed job shows an
actual resource limit and an owner approves its cost.

The PR E2E suite intentionally uses one full Chromium shard and one VRT shard.
This retains browser coverage while avoiding the inherited six-way shard fanout
and its peak runner demand. A Linux Electron build remains as the PR platform
compatibility signal; the macOS mobile build and desktop E2E are restricted to
protected integration events rather than ordinary web PRs.

Depot's OIDC grants and `depot/test-report-action` were removed from the
ordinary CI paths. The remaining `id-token: write` permissions belong only to
upstream npm-publishing workflows, which are guarded with
`github.repository == 'actualbudget/actual'` and are skipped in this fork.
The inherited Docker, Netlify, package, store, Flathub, and release-generation
jobs use the same guard, so a push or manual dispatch in ActuYNAB cannot publish
an upstream release or consume upstream deployment secrets.

GitHub-hosted standard runners are free for this public repository. If the
repository becomes private, track Linux, Windows, macOS, artifact, and cache
usage in GitHub's billing view before enabling optional platform jobs. See
[GitHub-hosted runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

## Recommended `master` protection

Configure these settings manually after the initial integration approval:

- Require a pull request before merging, at least one approving review, all
  review conversations resolved, and branches up to date before merging.
- Require the Test jobs for constraints, lint, typecheck, unit/integration
  tests, migrations, and GitHub-Action validation; Build jobs that cover API,
  browser, and sync-server builds; `CodeQL / Analyze`; and
  `Secret Scan / Gitleaks`. Select the exact job labels emitted on the first
  green PR when creating the rule, because runner and matrix labels can differ
  from the workflow names.
- Leave path-filtered checks such as dependency review, API browser E2E, and
  E2E/VRT shards optional at the branch-rule level; require their successful
  run whenever their paths apply. Otherwise documentation-only PRs can be
  blocked by a check that is intentionally absent.
- Block force pushes and branch deletion. Apply the rule to administrators
  too, with narrowly reviewed emergency bypasses only.
- Allow merge commits and leave “require linear history” off while integrating
  this stacked series. Restrict integration to the merge-commit strategy until
  the dependency chain has reached `master`.

## Human approval points

A repository administrator must approve the ordered PR merges, enable the
listed required checks and protection rule, and decide later how PR #6 should
be retained. None of those actions is performed by this branch. A human must
also review the two Windows-1252 failures as a separate runtime investigation
before declaring a fully green Windows baseline.
