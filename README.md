<p align="center">
  <img src="/demo.png" alt="ActuYNAB" />
</p>

## ActuYNAB

ActuYNAB is a privacy-first, local-first household finance application. It is a
maintained fork of [Actual Budget](https://github.com/actualbudget/actual) that
keeps Actual's envelope-budgeting engine, SQLite data model, and sync protocol
while adding safe household workflows for Portuguese bank imports, reviewable
categorization, financing, and day-to-day budgeting.

Financial data stays under the owner's control. ActuYNAB does not require a
cloud account or upload bank statements to an external service.

## Getting started

Read the [ActuYNAB documentation](docs/actuynab/README.md) for the architecture,
local Windows/Docker setup, validation procedures, and current roadmap.

- Run the web development app with `yarn start`.
- Run the local sync server together with the client using `yarn start:server-dev`.
- For the private Docker setup, follow
  [the local development guide](docs/actuynab/local-docker-development.md).

## Development

ActuYNAB is a Yarn workspaces monorepo. Node.js 22+ and the repository-pinned
Yarn release are required.

```bash
yarn install
yarn start
```

Run checks from the repository root:

```bash
yarn typecheck
yarn lint
yarn test
```

## Product boundaries

ActuYNAB reuses Actual's financial engine and synchronization protocol. It does
not replace them with a second database or a new accounting model. Package
names, protocol identifiers, legacy data-directory names, and the
`actual-server` command remain stable for compatibility with existing budgets,
desktop upgrades, and synchronization.

The visible product name, web/PWA metadata, mobile labels, desktop package
name, and ActuYNAB-authored documentation use **ActuYNAB**. References to
Actual Budget are retained only for upstream attribution, archive/import
compatibility, and technical implementation context.

## Contributing

See [AGENTS.md](AGENTS.md) and the ActuYNAB documentation before making changes.
Financial changes require synthetic-data regression coverage and must preserve
Actual's accounting and synchronization contracts.

## Upstream and license

ActuYNAB retains the upstream Actual Budget copyright notices and MIT license.
See the [upstream project](https://github.com/actualbudget/actual) for its
community documentation and wider ecosystem.
