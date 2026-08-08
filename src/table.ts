export type ColumnId = string;

export interface Column {
  id: ColumnId;
  name: string;
  visible?: boolean;
  searchPlaceholder?: string | false;
  datalist?: boolean;
  sortable?: boolean;
  compare?: (a: RowData, b: RowData) => number;
  render?: (row: RowData, td: HTMLTableCellElement) => void;
  renderHeader?: (th: HTMLTableCellElement) => void;
}

export type SortOrder = "ascent" | "descent";

export interface SortState {
  columnId: ColumnId;
  order: SortOrder;
}

export type RowData = Record<
  ColumnId,
  string | number | boolean | null | undefined
>;

export type CellFormatter = (
  value: string | number | boolean | null | undefined,
  columnId: ColumnId,
) => Node;

export interface Formatters {
  theadCell?: CellFormatter;
  tbodyCell?: CellFormatter;
  tfootCell?: CellFormatter;
}

export interface Plugin {
  addEventListeners(): void;
  removeEventListeners(): void;
}

export interface PaginationRenderParams {
  currentPage: number;
  totalPages: number;
  maxPageButtons?: number;
}

export interface PaginationOptions {
  pageSize: number;
  container: HTMLElement | null;
  maxPageButtons?: number;
  render?: (params: PaginationRenderParams) => HTMLElement;
}

export interface ColumnSearchOptions {
  placeholder?: string;
  debounce?: number;
  datalist?: boolean;
}

export interface ColumnSelectorRenderParams {
  columns: Column[];
  toggleColumn: (columnId: ColumnId) => void;
}

export interface ColumnSelectorOptions {
  container: HTMLElement | null;
  render?: (params: ColumnSelectorRenderParams) => HTMLElement;
}

export type SortDirection = "ascending" | "descending" | "none";

export interface SortIndicatorOptions {
  render?: (direction: SortDirection) => HTMLElement | null;
}

export interface ComponentOptions {
  pagination?: PaginationOptions;
  columnSearch?: ColumnSearchOptions;
  columnSelector?: ColumnSelectorOptions;
  sortIndicator?: SortIndicatorOptions;
}

export interface TableOptions {
  data: RowData[];
  columns: Column[];
  plugins?: Plugin[];
  components?: ComponentOptions;
  formatters?: Formatters;
}

export class Table {
  container!: HTMLElement;

  readonly options: TableOptions;

  private static instanceCount = 0;
  private readonly instanceId = `table-${Table.instanceCount++}`;

  private readonly emptyString = "";
  private filters: Record<ColumnId, string> = {};
  private filteredData: RowData[] | null = null;
  private sortState: SortState | null = null;
  private displayDataCache: RowData[] | null = null;
  private searchDebounceTimers: Record<
    ColumnId,
    ReturnType<typeof globalThis.setTimeout>
  > = {};

  private plugins: Plugin[] = [];
  pagination?: Pagination;
  private columnSelector?: ColumnSelectorOptions;

  constructor(options: TableOptions) {
    this.options = options;
  }

  getVisibleColumns(): Column[] {
    const columns = this.options.columns;
    const visible: Column[] = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].visible !== false) visible.push(columns[i]);
    }
    return visible;
  }

  getDisplayData(): RowData[] {
    if (this.displayDataCache) return this.displayDataCache;
    const base = this.filteredData ?? this.options.data;
    if (!this.sortState) {
      this.displayDataCache = base;
      return this.displayDataCache;
    }
    const { columnId, order } = this.sortState;
    const column = this.getColumn(columnId);
    this.displayDataCache = [...base].sort((a, b) =>
      this.compareRows(a, b, column, columnId, order)
    );
    return this.displayDataCache;
  }

  private invalidateDisplayCache(): void {
    this.displayDataCache = null;
  }

  private preserveColumnWidths(): void {
    if (!this.container) return;
    const headerRow = this.container.querySelector<HTMLTableRowElement>(
      "thead tr",
    );
    if (!headerRow) return;
    // Measure with subpixel precision, then apply with border-box so the visual
    // width is preserved as closely as possible regardless of box-sizing.
    // Lock the table's own width in px so a CSS width:100% cannot redistribute
    // space and fight the explicit column widths during resize.
    // min-width:0 lets columns shrink below content intrinsic size under fixed layout.
    const ths = headerRow.cells;
    const widths: number[] = [];
    let total = 0;
    for (let i = 0; i < ths.length; i++) {
      const w = ths[i].getBoundingClientRect().width;
      widths.push(w);
      total += w;
    }
    this.container.style.tableLayout = "fixed";
    this.container.style.width = `${total}px`;
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i] as HTMLTableCellElement;
      const w = widths[i];
      th.style.boxSizing = "border-box";
      th.style.width = `${w}px`;
      th.style.minWidth = "0";
    }
    // Search-row / other thead cells must also allow shrink (inputs have min-width).
    const allHeaderCells = this.container.querySelectorAll<
      HTMLTableCellElement
    >(
      "thead th",
    );
    for (let i = 0; i < allHeaderCells.length; i++) {
      allHeaderCells[i].style.minWidth = "0";
    }
  }

  private compareRows(
    a: RowData,
    b: RowData,
    column: Column | undefined,
    columnId: ColumnId,
    order: SortOrder,
  ): number {
    if (column?.compare) {
      const result = column.compare(a, b);
      return order === "ascent" ? result : -result;
    }
    const av = a[columnId];
    const bv = b[columnId];
    if (typeof av === "number" && typeof bv === "number") {
      return order === "ascent" ? av - bv : bv - av;
    }
    return order === "ascent"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  }

  private getColumn(columnId: ColumnId): Column | undefined {
    const columns = this.options.columns;
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].id === columnId) return columns[i];
    }
    return undefined;
  }

  private isSortableEnabled(): boolean {
    const plugins = this.plugins;
    for (let i = 0; i < plugins.length; i++) {
      if (plugins[i] instanceof Sortable) return true;
    }
    return false;
  }

  isColumnSortable(columnId: ColumnId): boolean {
    if (!this.isSortableEnabled()) return false;
    return this.getColumn(columnId)?.sortable !== false;
  }

  isColumnObjectSortable(column: Column): boolean {
    return this.isSortableEnabled() && column.sortable !== false;
  }

  private getSortDirectionFor(columnId: ColumnId): SortDirection {
    if (this.sortState?.columnId !== columnId) return "none";
    return this.sortState.order === "ascent" ? "ascending" : "descending";
  }

  private renderSortIndicator(direction: SortDirection): HTMLElement | null {
    const renderFn = this.options.components?.sortIndicator?.render ??
      defaultSortIndicator;
    const indicator = renderFn(direction);
    if (indicator) indicator.classList.add("table-sort-indicator");
    return indicator;
  }

  private addPlugins(): void {
    this.plugins = this.options.plugins ?? [];
    for (let i = 0; i < this.plugins.length; i++) {
      const plugin = this.plugins[i];
      plugin.addEventListeners();
    }
  }

  private addComponents(): void {
    const { components } = this.options;
    if (!components) return;
    if (components.pagination) this.pagination = new Pagination(this);
    if (components.columnSelector) {
      this.columnSelector = components.columnSelector;
    }
  }

  private defaultCellFormatter(
    value: string | number | boolean | null | undefined,
  ): Text {
    return document.createTextNode(String(value ?? ""));
  }

  private getCellFormatter(
    layoutTagName: "thead" | "tbody" | "tfoot",
  ): CellFormatter {
    const { formatters } = this.options;
    if (!formatters) return this.defaultCellFormatter;
    switch (layoutTagName) {
      case "thead":
        return formatters.theadCell ?? this.defaultCellFormatter;
      case "tbody":
        return formatters.tbodyCell ?? this.defaultCellFormatter;
      case "tfoot":
        return formatters.tfootCell ?? this.defaultCellFormatter;
    }
  }

  private renderColumns(
    layoutTagName: "thead" | "tbody" | "tfoot",
    tagName: "th" | "td",
    datum: RowData,
    visibleColumns: Column[],
    isHeaderRow = false,
  ): HTMLTableRowElement {
    const tr = document.createElement("tr");
    const format = this.getCellFormatter(layoutTagName);
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      const cell = document.createElement(tagName);
      if (isHeaderRow && column.renderHeader) {
        column.renderHeader(cell as HTMLTableCellElement);
      } else if (!isHeaderRow && column.render) {
        column.render(datum, cell as HTMLTableCellElement);
      } else {
        const value = datum[column.id] ?? this.emptyString;
        cell.appendChild(format(value, column.id));
        // Enable ellipsis for long text so content length cannot force column growth
        if (tagName === "td") {
          const text = String(value);
          if (text) cell.title = text;
        }
      }
      // Prevent long cell content from expanding columns (works well with table-layout: fixed).
      // min-width:0 is required so columns can shrink below intrinsic content width.
      cell.style.minWidth = "0";
      if (tagName === "td") {
        cell.style.whiteSpace = "nowrap";
        cell.style.overflow = "hidden";
        cell.style.textOverflow = "ellipsis";
      } else if (tagName === "th") {
        // Header text should also clip under fixed layout so it cannot block shrink.
        cell.style.overflow = "hidden";
      }
      if (isHeaderRow && this.isColumnObjectSortable(column)) {
        cell.tabIndex = 0;
        const direction = this.getSortDirectionFor(column.id);
        cell.setAttribute("aria-sort", direction);
        const indicator = this.renderSortIndicator(direction);
        if (indicator) cell.appendChild(indicator);
      }
      tr.appendChild(cell);
    }
    return tr;
  }

  private renderSearchRow(): HTMLTableRowElement {
    const tr = document.createElement("tr");
    const searchOptions = this.options.components!.columnSearch!;
    const debounceMs = searchOptions.debounce ?? 200;
    const visibleColumns = this.getVisibleColumns();
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      const th = document.createElement("th");
      if (column.searchPlaceholder === false) {
        tr.appendChild(th);
        continue;
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "form-control form-control-sm";
      input.placeholder = column.searchPlaceholder ??
        searchOptions.placeholder ?? "";
      input.dataset["columnId"] = column.id;
      input.value = this.filters[column.id] ?? "";
      // Allow the column to shrink below the input's intrinsic min-width.
      input.style.minWidth = "0";
      input.style.width = "100%";
      input.addEventListener("input", (event) => {
        this.filters[column.id] = (event.target as HTMLInputElement).value;
        globalThis.clearTimeout(this.searchDebounceTimers[column.id]);
        this.searchDebounceTimers[column.id] = globalThis.setTimeout(() => {
          this.applyFilters();
        }, debounceMs);
      });
      th.appendChild(input);
      if (column.datalist ?? searchOptions.datalist ?? false) {
        const datalist = this.createDatalist(column.id);
        input.setAttribute("list", datalist.id);
        th.appendChild(datalist);
      }
      tr.appendChild(th);
    }
    return tr;
  }

  private renderThead(): HTMLTableSectionElement {
    const visibleColumns = this.getVisibleColumns();
    const datum: RowData = {};
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      datum[column.id] = column.name;
    }
    const thead = document.createElement("thead");
    thead.appendChild(
      this.renderColumns("thead", "th", datum, visibleColumns, true),
    );
    if (this.options.components?.columnSearch) {
      thead.appendChild(this.renderSearchRow());
    }
    return thead;
  }

  private renderTbody(): HTMLTableSectionElement {
    const tbody = document.createElement("tbody");
    const visibleColumns = this.getVisibleColumns();
    let data = this.getDisplayData();
    let start = 0;
    if (this.pagination) {
      const { pageSize } = this.pagination.pagination;
      start = (this.pagination.currentPage - 1) * pageSize;
      data = data.slice(start, start + pageSize);
    }
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const tr = this.renderColumns("tbody", "td", row, visibleColumns);
      tr.dataset["rowIndex"] = String(start + i);
      tbody.appendChild(tr);
    }
    return tbody;
  }

  private computeFilteredData(): RowData[] | null {
    const filters = this.filters;
    const activeFilters: [ColumnId, string][] = [];
    for (const key in filters) {
      const keyword = filters[key];
      if (keyword) activeFilters.push([key, keyword.toLowerCase()]);
    }
    if (activeFilters.length === 0) return null;

    const data = this.options.data;
    const result: RowData[] = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      let matches = true;
      for (let j = 0; j < activeFilters.length; j++) {
        const [key, keyword] = activeFilters[j];
        const value = String(row[key] ?? "").toLowerCase();
        if (!value.includes(keyword)) {
          matches = false;
          break;
        }
      }
      if (matches) result.push(row);
    }
    return result;
  }

  applyFilters(): void {
    this.filteredData = this.computeFilteredData();
    this.invalidateDisplayCache();
    this.updateSearchInputValidity();
    this.preserveColumnWidths();
    if (this.pagination) {
      this.pagination.currentPage = 1;
      this.pagination.render();
    }
    this.updateTbody();
  }

  private getColumnDatalistValues(columnId: ColumnId): string[] {
    const data = this.options.data;
    const seen = new Set<string>();
    const values: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const value = data[i][columnId];
      if (value === null || value === undefined || value === "") continue;
      const str = String(value);
      if (seen.has(str)) continue;
      seen.add(str);
      values.push(str);
    }
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }

  private appendDatalistOptions(
    datalist: HTMLDataListElement,
    columnId: ColumnId,
  ): void {
    const values = this.getColumnDatalistValues(columnId);
    for (let i = 0; i < values.length; i++) {
      const option = document.createElement("option");
      option.value = values[i];
      datalist.appendChild(option);
    }
  }

  private createDatalist(columnId: ColumnId): HTMLDataListElement {
    const datalist = document.createElement("datalist");
    datalist.id = `${this.instanceId}-datalist-${columnId}`;
    this.appendDatalistOptions(datalist, columnId);
    return datalist;
  }

  private updateSearchDatalists(): void {
    const searchOptions = this.options.components?.columnSearch;
    if (!searchOptions) return;
    const visibleColumns = this.getVisibleColumns();
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      if (!(column.datalist ?? searchOptions.datalist ?? false)) continue;
      const datalist = document.getElementById(
        `${this.instanceId}-datalist-${column.id}`,
      ) as HTMLDataListElement | null;
      if (!datalist) continue;
      datalist.replaceChildren();
      this.appendDatalistOptions(datalist, column.id);
    }
  }

  setData(data: RowData[]): void {
    this.options.data = data;
    this.filteredData = this.computeFilteredData();
    this.invalidateDisplayCache();
    this.updateSearchInputValidity();
    this.updateSearchDatalists();
    this.preserveColumnWidths();
    if (this.pagination) {
      this.pagination.currentPage = 1;
      this.pagination.render();
    }
    this.updateTbody();
  }

  setFilter(columnId: ColumnId, keyword: string): void {
    this.filters[columnId] = keyword;
    this.syncSearchInput(columnId);
    this.applyFilters();
  }

  getFilter(columnId: ColumnId): string {
    return this.filters[columnId] ?? "";
  }

  private updateSearchInputValidity(): void {
    if (!this.container) return;
    const filters = this.filters;
    let hasActiveFilters = false;
    for (const key in filters) {
      if (filters[key]) {
        hasActiveFilters = true;
        break;
      }
    }
    const noResults = hasActiveFilters &&
      (this.filteredData ?? this.options.data).length === 0;
    const inputs = this.container.querySelectorAll<HTMLInputElement>(
      "thead input[data-column-id]",
    );
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const columnId = input.dataset["columnId"] as ColumnId;
      const invalid = noResults && Boolean(filters[columnId]);
      input.classList.toggle("is-invalid", invalid);
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
    }
  }

  sortBy(columnId: ColumnId, order?: SortOrder): void {
    const isSameColumn = this.sortState?.columnId === columnId;
    const nextOrder: SortOrder = order ??
      (isSameColumn && this.sortState!.order === "ascent"
        ? "descent"
        : "ascent");
    this.sortState = { columnId, order: nextOrder };
    this.invalidateDisplayCache();
    this.updateSortIndicators();
    this.preserveColumnWidths();
    if (this.pagination) {
      this.pagination.currentPage = 1;
      this.pagination.render();
    }
    this.updateTbody();
  }

  getSortState(): SortState | null {
    return this.sortState;
  }

  private updateSortIndicators(): void {
    if (!this.container) return;
    const headerRow = this.container.querySelector<HTMLTableRowElement>(
      "thead tr",
    );
    if (!headerRow) return;
    const visibleColumns = this.getVisibleColumns();
    const ths = headerRow.querySelectorAll<HTMLTableCellElement>("th");
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      const column = visibleColumns[i];
      if (!column || !this.isColumnObjectSortable(column)) continue;
      const direction = this.getSortDirectionFor(column.id);
      th.setAttribute("aria-sort", direction);
      const oldIndicator = th.querySelector<HTMLElement>(
        ".table-sort-indicator",
      );
      const newIndicator = this.renderSortIndicator(direction);
      if (oldIndicator && newIndicator) {
        oldIndicator.replaceWith(newIndicator);
      } else if (oldIndicator && !newIndicator) {
        oldIndicator.remove();
      } else if (!oldIndicator && newIndicator) {
        th.appendChild(newIndicator);
      }
    }
  }

  private syncSearchInput(columnId: ColumnId): void {
    if (!this.container) return;
    const input = this.container.querySelector<HTMLInputElement>(
      `thead input[data-column-id="${columnId}"]`,
    );
    if (input) input.value = this.filters[columnId] ?? "";
  }

  private renderColumnSelector(): void {
    const selector = this.columnSelector;
    if (!selector?.container) return;
    selector.container.replaceChildren();
    const renderFn = selector.render ?? defaultColumnSelector;
    const element = renderFn({
      columns: this.options.columns,
      toggleColumn: (columnId) => this.toggleColumn(columnId),
    });
    selector.container.appendChild(element);
  }

  toggleColumn(columnId: ColumnId): void {
    const column = this.getColumn(columnId);
    if (!column) return;
    column.visible = column.visible === false ? true : false;

    let resizable: Resizable | undefined;
    for (let i = 0; i < this.plugins.length; i++) {
      const plugin = this.plugins[i];
      if (plugin instanceof Resizable) {
        resizable = plugin;
        break;
      }
    }
    resizable?.reset();
    this.update();
  }

  render(container: HTMLElement): HTMLElement {
    this.container = container;
    this.addPlugins();
    this.addComponents();
    return this.update();
  }

  update(): HTMLElement {
    this.container.replaceChildren();
    this.container.appendChild(this.renderThead());
    this.container.appendChild(this.renderTbody());
    if (this.columnSelector) this.renderColumnSelector();
    if (this.pagination) this.pagination.render();
    // With Resizable active, lock measured column widths under fixed layout
    // immediately so the first resize is not blocked by content min-width or
    // a CSS width:100% redistribution.
    for (let i = 0; i < this.plugins.length; i++) {
      if (this.plugins[i] instanceof Resizable) {
        this.preserveColumnWidths();
        break;
      }
    }
    return this.container;
  }

  updateTbody(): void {
    this.container.querySelector("tbody")?.remove();
    this.container.appendChild(this.renderTbody());
  }

  getRowElement(index: number): HTMLTableRowElement | undefined {
    return this.container.querySelector<HTMLTableRowElement>(
      `tbody > tr[data-row-index="${index}"]`,
    ) ?? undefined;
  }

  getPageForIndex(index: number): number {
    if (!this.pagination) return 1;
    return Math.floor(index / this.pagination.pagination.pageSize) + 1;
  }

  destroy(): void {
    const plugins = this.plugins;
    for (let i = 0; i < plugins.length; i++) {
      plugins[i].removeEventListeners();
    }
    this.pagination?.removeEventListeners();
    for (const timer of Object.values(this.searchDebounceTimers)) {
      globalThis.clearTimeout(timer);
    }
  }
}

type HoverStatus = "left" | "right" | "in" | "out";

class Cell {
  protected collisionWidth = 10;

  protected findCell(
    event: PointerEvent,
    tagNames: string[],
  ): HTMLElement | undefined {
    const targets = document.elementsFromPoint(event.clientX, event.clientY);
    for (let i = 0; i < targets.length; i++) {
      const node = targets[i];
      if (tagNames.includes(node.tagName.toLowerCase())) {
        return node as HTMLElement;
      }
    }
    return undefined;
  }

  protected getHoverStatus(
    event: PointerEvent,
    cell: HTMLElement | undefined,
  ): HoverStatus {
    if (!cell) return "out";
    const { left, right } = cell.getBoundingClientRect();
    if (event.clientX <= left + this.collisionWidth) return "left";
    if (right - this.collisionWidth <= event.clientX) return "right";
    return "in";
  }

  protected findIndex(
    cells: HTMLCollectionOf<HTMLTableCellElement>,
    cell: HTMLElement,
  ): number {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === cell) return i;
    }
    return -1;
  }
}

export class Editable extends Cell implements Plugin {
  private readonly table: Table;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onBlur: (e: FocusEvent) => void;

  constructor(table: Table) {
    super();
    this.table = table;
    this.onPointerDown = this.editCell.bind(this);
    this.onBlur = this.saveCell.bind(this);
  }

  addEventListeners(): void {
    this.table.container.addEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.addEventListener(
      "blur",
      this.onBlur as EventListener,
      true,
    );
  }

  removeEventListeners(): void {
    this.table.container.removeEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.removeEventListener(
      "blur",
      this.onBlur as EventListener,
      true,
    );
  }

  private editCell(event: PointerEvent): void {
    const cell = this.findCell(event, ["td"]);
    if (!cell) return;
    cell.contentEditable = "true";
    cell.focus();
  }

  private saveCell(event: FocusEvent): void {
    const cell = (event.target as HTMLElement).closest("td");
    if (!cell) return;
    cell.contentEditable = "false";
  }
}

interface ResizingCells {
  left: HTMLElement | undefined;
  right: HTMLElement | undefined;
}

export class Resizable extends Cell implements Plugin {
  private resizingCells: ResizingCells | null = null;

  private readonly table: Table;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerUp: () => void;
  private readonly onResize: () => void;

  constructor(table: Table) {
    super();
    this.table = table;
    this.onPointerMove = this.hoverCellBorder.bind(this);
    this.onPointerDown = this.resizeStartCell.bind(this);
    this.onPointerUp = this.resizeEndCell.bind(this);
    this.onResize = this.reset.bind(this);
  }

  addEventListeners(): void {
    this.table.container.style.tableLayout = "auto";
    this.table.container.addEventListener(
      "pointermove",
      this.onPointerMove as EventListener,
    );
    this.table.container.addEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.addEventListener("pointerup", this.onPointerUp);
    globalThis.addEventListener("resize", this.onResize);
  }

  removeEventListeners(): void {
    this.table.container.style.tableLayout = "inherit";
    this.table.container.style.width = "";
    this.table.container.removeEventListener(
      "pointermove",
      this.onPointerMove as EventListener,
    );
    this.table.container.removeEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.removeEventListener("pointerup", this.onPointerUp);
    globalThis.removeEventListener("resize", this.onResize);
  }

  reset(): void {
    this.table.container.style.tableLayout = "auto";
    this.table.container.style.width = "";
    const headers = this.table.container.querySelectorAll<HTMLTableCellElement>(
      "thead th",
    );
    for (let i = 0; i < headers.length; i++) {
      const th = headers[i];
      th.style.boxSizing = "";
      th.style.width = "";
      th.style.minWidth = "";
      th.style.maxWidth = "";
    }
  }

  private setPointerStyle(
    event: PointerEvent,
    cell: HTMLElement | undefined,
  ): void {
    const status = this.getHoverStatus(event, cell);
    this.table.container.style.cursor = status === "left" || status === "right"
      ? "col-resize"
      : "inherit";
  }

  private resizeStartCell(event: PointerEvent): void {
    const cell = this.findCell(event, ["th"]);
    if (!cell) return;
    const status = this.getHoverStatus(event, cell);
    if (status === "in") return;
    const row = cell.parentNode as HTMLTableRowElement;
    if (!row.closest("thead") || row !== row.closest("thead")!.rows[0]) return;
    cell.setPointerCapture(event.pointerId);
    const columns = row.getElementsByTagName("th");
    const index = this.findIndex(columns, cell);
    // Snapshot current widths, then lock table to fixed layout + explicit px
    // width so CSS width:100% / content min-width cannot resist shrinking.
    let total = 0;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const w = column.getBoundingClientRect().width;
      total += w;
      column.style.boxSizing = "border-box";
      column.style.width = `${w}px`;
      column.style.minWidth = "0";
    }
    this.table.container.style.tableLayout = "fixed";
    this.table.container.style.width = `${total}px`;
    this.resizingCells = status === "left"
      ? { left: columns[index - 1] as HTMLElement | undefined, right: cell }
      : { left: cell, right: columns[index + 1] as HTMLElement | undefined };
  }

  private resizeEndCell(): void {
    this.resizingCells = null;
  }

  private hoverCellBorder(event: PointerEvent): void {
    if (this.resizingCells) {
      const { left, right } = this.resizingCells;
      if (!left || !right) return;
      const leftWidth = left.offsetWidth + event.movementX;
      const rightWidth = right.offsetWidth - event.movementX;
      if (leftWidth <= 30 || rightWidth <= 30) return;
      left.style.width = `${leftWidth}px`;
      right.style.width = `${rightWidth}px`;
      return;
    }
    const cell = this.findCell(event, ["th"]);
    this.setPointerStyle(event, cell);
  }
}

export class Sortable extends Cell implements Plugin {
  private sorting = false;
  private resizable?: Resizable;
  private pointerDownCell: HTMLElement | null = null;

  private readonly table: Table;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(table: Table, options?: { resizable?: Resizable }) {
    super();
    this.table = table;
    this.resizable = options?.resizable;
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerUp = this.sortRows.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
  }

  addEventListeners(): void {
    this.table.container.addEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.addEventListener(
      "pointerup",
      this.onPointerUp as EventListener,
    );
    this.table.container.addEventListener(
      "keydown",
      this.onKeyDown as EventListener,
    );
  }

  removeEventListeners(): void {
    this.table.container.removeEventListener(
      "pointerdown",
      this.onPointerDown as EventListener,
    );
    this.table.container.removeEventListener(
      "pointerup",
      this.onPointerUp as EventListener,
    );
    this.table.container.removeEventListener(
      "keydown",
      this.onKeyDown as EventListener,
    );
  }

  private resolveHeaderColumnId(cell: HTMLElement): ColumnId | undefined {
    const row = cell.parentNode as HTMLTableRowElement;
    if (!row.closest("thead") || row !== row.closest("thead")!.rows[0]) {
      return undefined;
    }
    const columns = row.getElementsByTagName("th");
    const index = this.findIndex(columns, cell);
    const column = this.table.getVisibleColumns()[index];
    if (!column || !this.table.isColumnObjectSortable(column)) return undefined;
    return column.id;
  }

  private handlePointerDown(event: PointerEvent): void {
    const interactive = (event.target as HTMLElement).closest(
      "input, textarea, select, button, [data-no-sort]",
    );
    if (interactive) return;
    const cell = this.findCell(event, ["th"]);
    if (!cell) return;
    const columnId = this.resolveHeaderColumnId(cell);
    if (!columnId) return;
    const status = this.getHoverStatus(event, cell);
    if (this.resizable && status !== "in") return;
    this.pointerDownCell = cell;
  }

  private sortRows(event: PointerEvent): void {
    if (this.sorting) return;
    if (!this.pointerDownCell) return;
    const interactive = (event.target as HTMLElement).closest(
      "input, textarea, select, button, [data-no-sort]",
    );
    if (interactive) {
      this.pointerDownCell = null;
      return;
    }
    const cell = this.findCell(event, ["th"]);
    if (cell !== this.pointerDownCell) {
      this.pointerDownCell = null;
      return;
    }
    const columnId = this.resolveHeaderColumnId(cell);
    if (!columnId) {
      this.pointerDownCell = null;
      return;
    }
    this.sorting = true;
    this.table.sortBy(columnId);
    this.sorting = false;
    this.pointerDownCell = null;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = (event.target as HTMLElement).closest("th");
    if (!cell) return;
    const columnId = this.resolveHeaderColumnId(cell);
    if (!columnId) return;
    event.preventDefault();
    this.table.sortBy(columnId);
  }
}

export class Pagination {
  private readonly table: Table;
  readonly pagination: PaginationOptions;
  currentPage = 1;

  private readonly onClick: (e: MouseEvent) => void;

  constructor(table: Table) {
    this.table = table;
    this.pagination = table.options.components!.pagination!;
    this.onClick = this.handleClick.bind(this);
    this.addEventListeners();
  }

  addEventListeners(): void {
    this.pagination.container?.addEventListener("click", this.onClick);
  }

  removeEventListeners(): void {
    this.pagination.container?.removeEventListener("click", this.onClick);
  }

  getTotalPages(): number {
    return Math.ceil(
      this.table.getDisplayData().length / this.pagination.pageSize,
    );
  }

  private handleClick(event: MouseEvent): void {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-page]",
    );
    if (!button) return;
    const page = button.dataset["page"];
    let target: number;
    switch (page) {
      case "prev":
        target = this.currentPage - 1;
        break;
      case "next":
        target = this.currentPage + 1;
        break;
      default:
        target = Number(page);
        break;
    }
    this.goToPage(target);
  }

  goToPage(page: number): void {
    const total = this.getTotalPages();
    this.currentPage = Math.min(Math.max(page, 1), total);
    this.table.updateTbody();
    this.render();
  }

  render(): void {
    const { container } = this.pagination;
    if (!container) return;
    container.replaceChildren();
    const renderFn = this.pagination.render ?? defaultPagination;
    const element = renderFn({
      currentPage: this.currentPage,
      totalPages: this.getTotalPages(),
      maxPageButtons: this.pagination.maxPageButtons,
    });
    container.appendChild(element);
  }
}

export function defaultPagination(
  { currentPage, totalPages, maxPageButtons }: PaginationRenderParams,
): HTMLElement {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Page navigation");
  const ul = document.createElement("ul");
  ul.className = "pagination";

  const createItem = (
    label: string,
    page: string | number,
    disabled = false,
    active = false,
  ): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "page-item" + (disabled ? " disabled" : "") +
      (active ? " active" : "");
    const button = document.createElement("button");
    button.className = "page-link";
    button.textContent = label;
    button.dataset["page"] = String(page);
    if (disabled) button.disabled = true;
    li.appendChild(button);
    return li;
  };

  const createArrowItem = (
    ariaLabel: string,
    page: string,
    symbol: string,
    disabled = false,
  ): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "page-item" + (disabled ? " disabled" : "");
    const button = document.createElement("button");
    button.className = "page-link";
    button.setAttribute("aria-label", ariaLabel);
    button.dataset["page"] = page;
    if (disabled) button.disabled = true;
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = symbol;
    button.appendChild(span);
    li.appendChild(button);
    return li;
  };

  const createEllipsis = (): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "page-item disabled";
    const span = document.createElement("span");
    span.className = "page-link";
    span.textContent = "…";
    li.appendChild(span);
    return li;
  };

  const pageNumbers = (() => {
    if (!maxPageButtons || totalPages <= maxPageButtons) {
      return { start: 1, end: totalPages };
    }
    const half = Math.floor(maxPageButtons / 2);
    let start = currentPage - half;
    let end = currentPage + (maxPageButtons - half - 1);
    if (start < 1) {
      end += 1 - start;
      start = 1;
    }
    if (end > totalPages) {
      start -= end - totalPages;
      end = totalPages;
    }
    start = Math.max(1, start);
    return { start, end };
  })();

  ul.appendChild(
    createArrowItem("Previous", "prev", "&laquo;", currentPage === 1),
  );

  if (pageNumbers.start > 1) {
    ul.appendChild(createItem("1", 1));
    if (pageNumbers.start > 2) ul.appendChild(createEllipsis());
  }
  for (let i = pageNumbers.start; i <= pageNumbers.end; i++) {
    ul.appendChild(createItem(String(i), i, false, i === currentPage));
  }
  if (pageNumbers.end < totalPages) {
    if (pageNumbers.end < totalPages - 1) ul.appendChild(createEllipsis());
    ul.appendChild(createItem(String(totalPages), totalPages));
  }
  ul.appendChild(
    createArrowItem("Next", "next", "&raquo;", currentPage === totalPages),
  );

  nav.appendChild(ul);
  return nav;
}

export function defaultSortIndicator(
  direction: SortDirection,
): HTMLElement | null {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.display = "inline-block";
  span.style.marginLeft = "0.3em";
  span.style.visibility = direction === "none" ? "hidden" : "visible";
  span.style.transform = direction === "descending"
    ? "rotate(180deg)"
    : "rotate(0deg)";
  span.innerHTML =
    `<svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" style="display:block">` +
    `<path d="M5 0 L10 6 H0 Z"/></svg>`;
  return span;
}

export function defaultColumnSelector(
  { columns, toggleColumn }: ColumnSelectorRenderParams,
): HTMLElement {
  const details = document.createElement("details");
  details.className = "table-columns";
  const summary = document.createElement("summary");
  summary.textContent = "Columns";
  details.appendChild(summary);
  const ul = document.createElement("ul");
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.className = "table-columns-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = column.visible !== false;
    input.addEventListener("change", () => toggleColumn(column.id));
    label.appendChild(input);
    label.append(` ${column.name}`);
    li.appendChild(label);
    ul.appendChild(li);
  }
  details.appendChild(ul);
  return details;
}
