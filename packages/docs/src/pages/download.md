---
title: Downloads
hide_table_of_contents: true
---

# Download ActuYNAB

ActuYNAB is currently distributed from its source repository. It is intentionally
not represented by the upstream Actual Budget installers, Microsoft Store entry,
or hosted demo: those are releases of a different project.

## Run locally

For a Windows 11 development or private household preview, clone
[ActuYNAB](https://github.com/jrvelloso/actuyanb), install the repository-pinned
Node.js/Yarn toolchain, and run:

```bash
yarn install
yarn start
```

The [local Docker guide](https://github.com/jrvelloso/actuyanb/blob/master/docs/actuynab/local-docker-development.md)
explains how to pair the browser client with a private, localhost-only sync server.

## Build desktop packages

The Electron wrapper can be built from the same checkout:

```bash
yarn build:desktop
```

Generated desktop packages are named **ActuYNAB**. Their application IDs,
protocol names, legacy data directory, and sync-server command remain compatible
with existing Actual-based installations.

## Synchronization server

Use the native `actual-server` command or the private Docker configuration. The
command name is retained for protocol compatibility; the product is ActuYNAB.
Do not expose a server publicly without HTTPS, authentication, persistent
storage, and tested backups.
