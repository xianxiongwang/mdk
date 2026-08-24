# DataTable

Sortable, paginated, optionally selectable / expandable table built on
TanStack React Table. Controlled and uncontrolled modes for each piece of
state.

## Props (subset)

| Prop                      | Type                                      | Required | Default | Description                              |
| ------------------------- | ----------------------------------------- | -------- | ------- | ---------------------------------------- |
| `data`                    | `I[]`                                     | Yes      | —       | Rows                                     |
| `columns`                 | `DataTableColumnDef<I>[]`                 | Yes      | —       | TanStack column defs                     |
| `fullWidth`               | `boolean`                                 | No       | `true`  | Stretch to container width               |
| `enableRowSelection`      | `boolean \| ((row) => boolean)`           | No       | `false` | Checkbox column                          |
| `enableMultiRowSelection` | `boolean`                                 | No       | `true`  | Allow multi-select                       |
| `selections`              | `DataTableRowSelectionState`              | No       | —       | Controlled row-selection state           |
| `onSelectionsChange`      | `(s: DataTableRowSelectionState) => void` | No       | —       | Setter                                   |
| `enablePagination`        | `boolean`                                 | No       | `true`  | Show pagination footer                   |
| `pagination`              | `DataTablePaginationState`                | No       | —       | Controlled pagination                    |
| `sorting`                 | `DataTableSortingState`                   | No       | —       | Controlled sorting                       |
| `bordered`                | `boolean`                                 | No       | `false` | Add cell borders                         |
| `loading`                 | `boolean`                                 | No       | `false` | Show loading overlay                     |
| `enableRowExpansion`      | `boolean`                                 | No       | `false` | Show row expansion column                |
| `renderExpandedContent`   | `(row) => ReactNode`                      | No       | —       | Required when row expansion is enabled   |
| `getRowId`                | `(row, index, parent?) => string`         | No       | index   | Stable row ID source                     |
| `onRowClick`              | `(rowData: I) => void`                    | No       | —       | Makes rows interactive (see note below)  |

See [`data-table.tsx`](./data-table.tsx) for the full list (16 props).

> [!NOTE]
> Setting `onRowClick` makes every body row `role="button"`, focusable, and keyboard-activatable
> (Enter/Space). Clicks starting inside a `button`, `a`, `input`, `label`, `[role="checkbox"]`, or
> anything marked `data-no-row-click` are ignored, so the selection checkbox and expand toggle keep
> working independently of the row click.

### Column `meta`

| Field   | Applied by `DataTable` | Description                            |
| ------- | ---------------------- | -------------------------------------- |
| `align` | Yes                    | `left` \| `center` \| `right` on cells |

## Example

```tsx
<DataTable<Miner>
  data={data}
  columns={columns}
  getRowId={(row) => row.id}
  enablePagination
/>
```

## Data contracts

`DataTableColumnDef`, `DataTableRow`, `DataTableSortingState`,
`DataTablePaginationState`, `DataTableRowSelectionState`, `DataTableExpandedState`
are re-exported from `@tetherto/mdk-react-devkit`.
