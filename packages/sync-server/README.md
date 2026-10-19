# ActuYNAB sync server

This package runs the ActuYNAB synchronization server. ActuYNAB is a
local-first household finance application built on
[Actual Budget](https://github.com/actualbudget/actual). The server persists
synchronized budget changes and makes them available across devices; it does
not calculate budgets or replace the local financial engine.

ActuYNAB is free and open source. For a private local or Docker setup, use the
[ActuYNAB operations guide](../../docs/actuynab/operations.md).

## Using the CLI tool

Node.js v22 or higher is required for the `@actual-app/sync-server` npm package.

```bash
npm install --location=global @actual-app/sync-server
```

The binary intentionally remains `actual-server` for compatibility with
existing clients, configuration, and Docker deployments.

```bash
actual-server [options]
```

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `-h` or `--help`    | Print this list and exit.    |
| `-v` or `--version` | Print this version and exit. |
| `--config`          | Path to the config file.     |
| `--reset-password`  | Reset the server password.   |

Examples:

```bash
actual-server
actual-server --config ./config.json
actual-server --reset-password
```

For upstream protocol and server details, consult the
[Actual Budget documentation](https://actualbudget.org/docs/). The command and
package namespace are technical compatibility contracts; the product shown to
users is ActuYNAB.
