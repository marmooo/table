# @marmooo/table

A dependency-free HTML `<table>` library. Sorting, per-column filtering,
pagination, column visibility, column resizing, and cell editing are all opt-in
plugins/components that you can combine as needed.

> **Note**: the built-in UI (search inputs, pagination, column selector) uses
> Bootstrap class names (`form-control`, `is-invalid`, `pagination`,
> `page-item`, `page-link`, etc). Everything still works without Bootstrap's CSS
> loaded, but borders and spacing won't look right. If you want a fully custom
> look, override it with the `render` options described below.

## Install

```
npm install <package-name>
```

## Basic usage

```ts
import { Table } from "table";

const table = new Table({
  data: [
    { id: 1, name: "Alice", age: 30 },
    { id: 2, name: "Bob", age: 25 },
  ],
  columns: [
    { id: "id", name: "ID" },
    { id: "name", name: "Name" },
    { id: "age", name: "Age" },
  ],
});

const container = document.querySelector("table")!;
table.render(container);
```

`columns[].id` maps to a key on each row object in `data`. By default, values
are rendered as plain text.

## Plugins

Sorting, resizing, and cell editing are each independent plugins passed via
`plugins`. If you don't pass one, that feature is simply off (e.g. without
`Sortable`, clicking a header does nothing).

```ts
import { Editable, Resizable, Sortable, Table } from "table";

const table = new Table({ data, columns });
const resizable = new Resizable(table);

table.options.plugins = [
  new Sortable(table, { resizable }), // pass `resizable` when using both, so a column-border drag isn't mistaken for a sort click
  resizable,
  new Editable(table),
];

table.render(container);
```

### Sortable

- Sorting is triggered by clicking a header, or by pressing Enter / Space
  (headers automatically get `tabindex="0"`).
- The current sort column/order is exposed both via `aria-sort` (`ascending` /
  `descending` / `none`) and an arrow icon in the header.
- Sorting itself is non-destructive and lives in `Table`; it never mutates
  `options.data` directly.

Per-column control:

```ts
{
  id: "actions",
  name: "",
  sortable: false, // exclude this column from sorting (default: true)
  render: (row, td) => { /* buttons, etc. */ },
}
```

```ts
{
  id: "createdAt",
  name: "Created",
  // Ascending-order comparator (same convention as Array.prototype.sort:
  // negative if a comes first). Reversal for descending order is handled
  // automatically.
  compare: (a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
}
```

If `compare` isn't provided, columns compare numerically when both values are
`number`, and otherwise fall back to `String()` + `localeCompare`. For values
that don't sort correctly once stringified (`Date`, booleans, etc.), providing
`compare` is recommended.

### Resizable

Drag a column border to resize it. When a column's visibility is toggled via
`toggleColumn()`, widths are automatically reset via `reset()`.

### Editable

Clicking a `tbody` cell makes it `contentEditable`; it exits edit mode on blur.
It doesn't persist the value back into `data` — read it back yourself (e.g. on
`blur`) if you need to.

## Components (`options.components`)

### `pagination`

```ts
new Table({
  data,
  columns,
  components: {
    pagination: {
      pageSize: 20,
      container: document.querySelector("#pagination"),
      maxPageButtons: 5, // omit to show every page number
      // pass `render` to fully replace the markup (default is a Bootstrap-style nav/ul/li)
    },
  },
});
```

- Use `table.pagination.goToPage(n)` to change pages and
  `table.pagination.getTotalPages()` to get the page count.

### `columnSearch` (per-column filtering)

```ts
components: {
  columnSearch: {
    placeholder: "Search…",
    debounce: 200, // delay (ms) between the input event and applying the filter; default 200
  },
}
```

- Conditions across columns are ANDed; matching within a column is a
  case-insensitive substring match.
- Disable it per column with `column.searchPlaceholder: false`.
- **When a filter yields zero results**: instead of an empty-state row or
  message, the search input(s) responsible (the ones with a non-empty value) get
  an `is-invalid` class and `aria-invalid="true"`. No text is shown, so there's
  nothing to translate. If the zero-result state isn't caused by filtering (e.g.
  `data` itself is empty), nothing happens.
- To filter programmatically, use `table.setFilter(columnId, keyword)` /
  `table.getFilter(columnId)` (the search input's displayed value is kept in
  sync).

### `columnSelector` (column visibility toggle)

```ts
components: {
  columnSelector: {
    container: document.querySelector("#column-selector"),
    // pass `render` to replace the markup (default is a <details><summary>Columns</summary>...)
  },
}
```

### `sortIndicator` (sort arrow appearance)

```ts
components: {
  sortIndicator: {
    render: (direction) => {
      // direction: "ascending" | "descending" | "none"
      if (direction === "none") return null; // return null to hide it entirely
      const span = document.createElement("span");
      span.textContent = direction === "ascending" ? "▲" : "▼";
      return span;
    },
  },
}
```

`render` is called with the current `direction` whenever the sort state changes,
and its return value replaces the previous indicator wholesale — you don't need
to manage showing/hiding it yourself.

## Updating data

```ts
table.setData(newRows);
```

Existing filters and sort order are kept and re-applied; pagination resets to
page 1. Prefer this over mutating `options.data` directly, e.g. after fetching
data asynchronously.

## Looking up rows

```ts
table.getRowElement(index); // the <tr> currently rendered for this global index in getDisplayData() (undefined if its page isn't showing)
table.getPageForIndex(index); // which page that index belongs to
```

## Lifecycle

| Method                    | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `table.render(container)` | Initial render; also sets up plugins and components                  |
| `table.update()`          | Rebuilds everything, including `thead`/`tbody`                       |
| `table.updateTbody()`     | Rebuilds only `tbody` (also used internally after filtering/sorting) |
| `table.destroy()`         | Releases registered event listeners and debounce timers              |

## Types

Main exports: `Column`, `TableOptions`, `ComponentOptions`, `SortOrder`,
`SortState`, `SortDirection`, `RowData`, `Formatters`, `Plugin`.

`RowData` is `Record<ColumnId, string | number | boolean | null | undefined>`.
If a column needs to hold another type (e.g. `Date`), you'll need a
`column.compare` for sorting and a custom `render`/`formatters` for display.
