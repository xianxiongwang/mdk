# DeviceExplorer

Top-level device explorer: filter toolbar + searchable, sortable table of
miners or cabinets. Designed to be controlled by URL state in the host app.

## Props

| Prop                       | Type                                               | Required | Default | Description                                                                                                              |
| -------------------------- | -------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `deviceType`               | `DeviceExplorerDeviceType`                         | Yes      | —       | Active device-type tab                                                                                                   |
| `onDeviceTypeChange`       | `(deviceType: DeviceExplorerDeviceType) => void`   | Yes      | —       | Setter for the device type                                                                                               |
| `data`                     | `Device[]`                                         | Yes      | —       | Rows                                                                                                                     |
| `filters`                  | `LocalFilters`                                     | No       | —       | Controlled filter values                                                                                                 |
| `onFiltersChange`          | `(filters: LocalFilters) => void`                  | Yes      | —       | Setter for filters                                                                                                       |
| `filterOptions`            | `DeviceExplorerToolbarProps["filterOptions"]`      | Yes      | —       | Filter category definitions                                                                                              |
| `searchOptions`            | `DeviceExplorerToolbarProps["searchOptions"]`      | Yes      | —       | Searchable column definitions                                                                                            |
| `searchTags`               | `string[]`                                         | Yes      | —       | Active search-tag chips                                                                                                  |
| `onSearchTagsChange`       | `(tags: string[]) => void`                         | Yes      | —       | Setter for search tags                                                                                                   |
| `selectedDevices`          | `DataTableRowSelectionState`                       | No       | —       | Controlled row-selection state                                                                                           |
| `onSelectedDevicesChange`  | `(selections: DataTableRowSelectionState) => void` | No       | —       | Setter for row selection                                                                                                 |
| `renderAction`             | `(row) => React.ReactNode`                         | No       | —       | Renderer for the per-row action cell                                                                                     |
| `getFormattedDate`         | `(ts: number \| string) => string`                 | Yes      | —       | Date formatter from the host's timezone setup                                                                            |
| `onRowClick`               | `(device: DeviceExplorerDeviceData) => void`       | No       | —       | Makes rows interactive (click/Enter/Space); see the `DataTable` USAGE.md for the click-target exclusions this inherits   |
| `className`                | `string`                                           | No       | —       | Additional class names                                                                                                   |

## Minimal example

```tsx
<DeviceExplorer
  deviceType={deviceType}
  onDeviceTypeChange={setDeviceType}
  data={devices}
  filterOptions={filterOptions}
  searchOptions={searchOptions}
  searchTags={searchTags}
  onSearchTagsChange={setSearchTags}
  onFiltersChange={setFilters}
  getFormattedDate={(ts) => formatInTimezone(ts, tz)}
/>
```

## Data contracts

- `DeviceExplorerDeviceType = "miner" | "cabinet"`
- `Device` — [`foundation/types/device`](../../types/device.ts)
- `LocalFilters`, `DataTableRowSelectionState` — re-exported from `core`.

## Notes

- The component handles the device-type/sorting interaction internally:
  switching to `cabinet` selects a default sort by `id` desc, switching to
  `miner` clears sort.
- Wrap the page in `<MdkProvider>`; the toolbar calls `useDeviceResolution`
  and the table consumes `useTimezoneFormatter`.
