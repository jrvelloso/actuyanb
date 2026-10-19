# ActuYNAB branding and compatibility

## Product name

**ActuYNAB** is the user-facing name of this fork. The browser title, PWA
manifest, welcome and authentication screens, desktop package metadata, mobile
labels, product documentation, release messages, and error/help copy use this
name.

ActuYNAB is built from Actual Budget and retains the upstream attribution and
MIT license. References to Actual Budget are intentional only when they name
the upstream project, describe archive/import compatibility, or preserve the
historical context of imported upstream documentation.

The bundled in-app news feed starts empty for this fork. It does not present
upstream Actual Budget releases as ActuYNAB releases; future ActuYNAB release
entries can be added deliberately to that feed.

## Compatibility identifiers intentionally retained

The following identifiers are not product-facing branding. They remain unchanged
because changing them would risk an incompatible installation, updater, budget,
or synchronization migration:

- `@actual-app/*` package names and `window.Actual` bridge;
- the `actual-server` command, server image/service names, and protocol headers;
- Electron AppUserModel ID, application ID, AppX identity, Linux desktop ID,
  mobile bundle/application IDs, and custom URL schemes;
- legacy `Actual` user-data/document-directory names and existing budget-file
  formats;
- database tables, CRDT messages, and import format labels.

Desktop installers are now visibly named ActuYNAB. Because their technical
identity is retained, an upgrade does not silently move a user's existing data
or create a second synchronization identity.

## Documentation hosting

The documentation site uses the ActuYNAB title and repository links. Its
deployment URL and base path are configurable through `ACTUYNAB_DOCS_URL` and
`ACTUYNAB_DOCS_BASE_URL`; its default is the fork's GitHub Pages location. The
upstream `actualbudget.org` CNAME is deliberately not carried by this fork.
