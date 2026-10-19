# ActuYNAB visual identity foundation

## Intent and boundary

ActuYNAB combines YNAB 4-inspired budget information architecture with
Actual's local-first financial engine and interactions. The supplied light and
dark reference images guide hierarchy, density, and tone; they are not a
pixel-for-pixel screen specification and no image asset is copied into the
product.

This foundation is deliberately a theme extension, not a replacement design
system. It leaves Actual's account balances, budget calculations, native cell
editor, undo/redo, SQLite/CRDT persistence, synchronization protocol, and M14
three-month layout unchanged.

## Theme contract

Primitive colours are declared once in
`packages/component-library/src/themes/palette.css`. Theme-specific CSS maps
them to semantic `--color-*` roles, and React code consumes the existing
`theme` facade in `packages/component-library/src/theme.ts`. Components must
use semantic roles rather than introduce a new literal colour.

| Role             | Light     | Dark      | Use                                        |
| ---------------- | --------- | --------- | ------------------------------------------ |
| Base background  | `#F8FAFC` | `#0B1220` | Application canvas                         |
| Raised surface   | `#FFFFFF` | `#111A2B` | Cards and table surfaces                   |
| Elevated surface | `#F1F5F9` | `#1A2538` | Menus, headers, hover layers               |
| Primary accent   | `#14B8A6` | `#14B8A6` | Primary action, active state, focus family |
| Success          | `#22C55E` | `#22C55E` | Positive balance and confirmation state    |
| Warning          | `#F59E0B` | `#F59E0B` | Attention-required state                   |
| Danger           | `#EF4444` | `#EF4444` | Overspending and destructive state         |
| Information      | `#3B82F6` | `#3B82F6` | Informational state and links              |

The themes select accessible shades of those primitives for text, borders, and
filled controls. Dark primary controls use a dark foreground; light primary
controls use a light foreground. The `focusRing` role supplies a 2px,
keyboard-visible outline without changing mouse focus behaviour.

`midnight` remains supported as a dark variant and resolves the same semantic
roles. This keeps existing user theme preferences valid while light and dark
remain the primary ActuYNAB review targets.

## Typography, finance, and branding

The client already loads Inter Variable, which remains the application font.
Existing heading, navigation, label, and table scales are retained so dense
financial tables continue to scan well. Currency and budget values continue to
use `FinancialText` or the existing tabular-number style; no formatting or
calculation code changes here.

The product name in web metadata is **ActuYNAB**. `sidebarBrand` is the
approved integration seam for the leaf-inspired logo direction. No logo is
created or substituted until an approved source asset is provided.

## M14 budget compatibility

The theme supports, rather than reshapes, the M14 grid:

- The account-centred sidebar retains account balances and compact active rows.
- The sticky category column and three month sheets remain side by side.
- Budgeted, Outflows, and Balance stay table-aligned and readable at high row
  density.
- Native allocation editing, month navigation, carryover, Undo/Redo, and
  persistence continue through Actual's existing components and handlers.
- A permanent right-side category panel is out of scope. A collapsible drawer
  can be evaluated later only if it does not hide the multi-month view.

## Manual review

Run from the repository root after dependencies are installed:

```powershell
yarn start:server-dev
```

Open `http://127.0.0.1:3001`, choose **Don't use a server** if the local sync
server is not being used, then choose **View demo**. This creates a disposable
sample budget and does not modify an existing budget.

Review each available light and dark theme through **Settings → Themes**:

1. Tab through sidebar links, a primary button, an input, a menu, and a modal;
   the teal focus ring must remain visible against each surface.
2. Check long account/category names, negative account balances, positive
   balances, and overspent categories. Text, borders, and status colours must
   remain distinguishable without relying only on colour.
3. Open **Budget**, use the **3 months** toggle in the title bar, and confirm
   all three months, compact summaries, sticky categories, and horizontal
   scrolling are still usable. Toggle it off and confirm the standard view
   returns.
4. Edit a synthetic budget allocation, reload, then use Undo and Redo. The
   same native value, carryover, and overspending behaviour must remain.
5. Narrow the browser to a mobile-sized viewport. Navigation and tables must
   remain operable; the grid may scroll horizontally rather than compressing
   monetary columns.

## Validation commands

```powershell
yarn workspace @actual-app/components test
yarn workspace @actual-app/web vitest --run src/components/budget/DynamicBudgetTable.test.ts
yarn workspace @actual-app/core vitest --run src/server/transactions/actuynab-multimonth-budget.test.ts
yarn lint
yarn typecheck
yarn workspace @actual-app/web build:browser
```

Use Chromium E2E only through an approved, available browser-control
environment. If it is unavailable, retain the manual checklist above as the
explicit visual acceptance record rather than attempting an unsupported local
browser launch.

## Deferred refinements

- Integrate an approved leaf logo asset and final favicon/app-icon set.
- Establish screenshot/visual-regression baselines after the product owner
  approves the theme direction.
- Audit every legacy custom-theme alias and migrate it incrementally to the
  semantic role names.
- Evaluate a collapsible category-details drawer only with the three-month
  layout visible and native editing unaffected.
- Refine optional data visualizations and category iconography after the core
  budget review; neither is needed for reliable financial scanning today.
