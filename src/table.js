// table.ts
var Table = class _Table {
  container;
  options;
  static instanceCount = 0;
  instanceId = `table-${_Table.instanceCount++}`;
  emptyString = "";
  filters = {};
  filteredData = null;
  sortState = null;
  displayDataCache = null;
  searchDebounceTimers = {};
  plugins = [];
  pagination;
  columnSelector;
  constructor(options) {
    this.options = options;
  }
  getVisibleColumns() {
    const columns = this.options.columns;
    const visible = [];
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].visible !== false) visible.push(columns[i]);
    }
    return visible;
  }
  getDisplayData() {
    if (this.displayDataCache) return this.displayDataCache;
    const base = this.filteredData ?? this.options.data;
    if (!this.sortState) {
      this.displayDataCache = base;
      return this.displayDataCache;
    }
    const { columnId, order } = this.sortState;
    const column = this.getColumn(columnId);
    this.displayDataCache = [
      ...base
    ].sort((a, b) => this.compareRows(a, b, column, columnId, order));
    return this.displayDataCache;
  }
  invalidateDisplayCache() {
    this.displayDataCache = null;
  }
  preserveColumnWidths() {
    if (!this.container) return;
    const headerRow = this.container.querySelector("thead tr");
    if (!headerRow) return;
    const ths = headerRow.cells;
    const widths = [];
    for (let i = 0; i < ths.length; i++) {
      widths.push(ths[i].getBoundingClientRect().width);
    }
    this.container.style.tableLayout = "fixed";
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      const w = widths[i];
      th.style.boxSizing = "border-box";
      th.style.width = `${w}px`;
      th.style.minWidth = `${w}px`;
      th.style.maxWidth = `${w}px`;
    }
  }
  compareRows(a, b, column, columnId, order) {
    if (column?.compare) {
      const result = column.compare(a, b);
      return order === "ascent" ? result : -result;
    }
    const av = a[columnId];
    const bv = b[columnId];
    if (typeof av === "number" && typeof bv === "number") {
      return order === "ascent" ? av - bv : bv - av;
    }
    return order === "ascent" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }
  getColumn(columnId) {
    const columns = this.options.columns;
    for (let i = 0; i < columns.length; i++) {
      if (columns[i].id === columnId) return columns[i];
    }
    return void 0;
  }
  isSortableEnabled() {
    const plugins = this.plugins;
    for (let i = 0; i < plugins.length; i++) {
      if (plugins[i] instanceof Sortable) return true;
    }
    return false;
  }
  isColumnSortable(columnId) {
    if (!this.isSortableEnabled()) return false;
    return this.getColumn(columnId)?.sortable !== false;
  }
  isColumnObjectSortable(column) {
    return this.isSortableEnabled() && column.sortable !== false;
  }
  getSortDirectionFor(columnId) {
    if (this.sortState?.columnId !== columnId) return "none";
    return this.sortState.order === "ascent" ? "ascending" : "descending";
  }
  renderSortIndicator(direction) {
    const renderFn = this.options.components?.sortIndicator?.render ?? defaultSortIndicator;
    const indicator = renderFn(direction);
    if (indicator) indicator.classList.add("table-sort-indicator");
    return indicator;
  }
  addPlugins() {
    this.plugins = this.options.plugins ?? [];
    for (let i = 0; i < this.plugins.length; i++) {
      const plugin = this.plugins[i];
      plugin.addEventListeners();
    }
  }
  addComponents() {
    const { components } = this.options;
    if (!components) return;
    if (components.pagination) this.pagination = new Pagination(this);
    if (components.columnSelector) {
      this.columnSelector = components.columnSelector;
    }
  }
  defaultCellFormatter(value) {
    return document.createTextNode(String(value ?? ""));
  }
  getCellFormatter(layoutTagName) {
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
  renderColumns(layoutTagName, tagName, datum, visibleColumns, isHeaderRow = false) {
    const tr = document.createElement("tr");
    const format = this.getCellFormatter(layoutTagName);
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      const cell = document.createElement(tagName);
      if (isHeaderRow && column.renderHeader) {
        column.renderHeader(cell);
      } else if (!isHeaderRow && column.render) {
        column.render(datum, cell);
      } else {
        const value = datum[column.id] ?? this.emptyString;
        cell.appendChild(format(value, column.id));
        if (tagName === "td") {
          const text = String(value);
          if (text) cell.title = text;
        }
      }
      if (tagName === "td") {
        cell.style.whiteSpace = "nowrap";
        cell.style.overflow = "hidden";
        cell.style.textOverflow = "ellipsis";
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
  renderSearchRow() {
    const tr = document.createElement("tr");
    const searchOptions = this.options.components.columnSearch;
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
      input.placeholder = column.searchPlaceholder ?? searchOptions.placeholder ?? "";
      input.dataset["columnId"] = column.id;
      input.value = this.filters[column.id] ?? "";
      input.addEventListener("input", (event) => {
        this.filters[column.id] = event.target.value;
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
  renderThead() {
    const visibleColumns = this.getVisibleColumns();
    const datum = {};
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      datum[column.id] = column.name;
    }
    const thead = document.createElement("thead");
    thead.appendChild(this.renderColumns("thead", "th", datum, visibleColumns, true));
    if (this.options.components?.columnSearch) {
      thead.appendChild(this.renderSearchRow());
    }
    return thead;
  }
  renderTbody() {
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
  computeFilteredData() {
    const filters = this.filters;
    const activeFilters = [];
    for (const key in filters) {
      const keyword = filters[key];
      if (keyword) activeFilters.push([
        key,
        keyword.toLowerCase()
      ]);
    }
    if (activeFilters.length === 0) return null;
    const data = this.options.data;
    const result = [];
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
  applyFilters() {
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
  getColumnDatalistValues(columnId) {
    const data = this.options.data;
    const seen = /* @__PURE__ */ new Set();
    const values = [];
    for (let i = 0; i < data.length; i++) {
      const value = data[i][columnId];
      if (value === null || value === void 0 || value === "") continue;
      const str = String(value);
      if (seen.has(str)) continue;
      seen.add(str);
      values.push(str);
    }
    values.sort((a, b) => a.localeCompare(b));
    return values;
  }
  appendDatalistOptions(datalist, columnId) {
    const values = this.getColumnDatalistValues(columnId);
    for (let i = 0; i < values.length; i++) {
      const option = document.createElement("option");
      option.value = values[i];
      datalist.appendChild(option);
    }
  }
  createDatalist(columnId) {
    const datalist = document.createElement("datalist");
    datalist.id = `${this.instanceId}-datalist-${columnId}`;
    this.appendDatalistOptions(datalist, columnId);
    return datalist;
  }
  updateSearchDatalists() {
    const searchOptions = this.options.components?.columnSearch;
    if (!searchOptions) return;
    const visibleColumns = this.getVisibleColumns();
    for (let i = 0; i < visibleColumns.length; i++) {
      const column = visibleColumns[i];
      if (!(column.datalist ?? searchOptions.datalist ?? false)) continue;
      const datalist = document.getElementById(`${this.instanceId}-datalist-${column.id}`);
      if (!datalist) continue;
      datalist.replaceChildren();
      this.appendDatalistOptions(datalist, column.id);
    }
  }
  setData(data) {
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
  setFilter(columnId, keyword) {
    this.filters[columnId] = keyword;
    this.syncSearchInput(columnId);
    this.applyFilters();
  }
  getFilter(columnId) {
    return this.filters[columnId] ?? "";
  }
  updateSearchInputValidity() {
    if (!this.container) return;
    const filters = this.filters;
    let hasActiveFilters = false;
    for (const key in filters) {
      if (filters[key]) {
        hasActiveFilters = true;
        break;
      }
    }
    const noResults = hasActiveFilters && (this.filteredData ?? this.options.data).length === 0;
    const inputs = this.container.querySelectorAll("thead input[data-column-id]");
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const columnId = input.dataset["columnId"];
      const invalid = noResults && Boolean(filters[columnId]);
      input.classList.toggle("is-invalid", invalid);
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
    }
  }
  sortBy(columnId, order) {
    const isSameColumn = this.sortState?.columnId === columnId;
    const nextOrder = order ?? (isSameColumn && this.sortState.order === "ascent" ? "descent" : "ascent");
    this.sortState = {
      columnId,
      order: nextOrder
    };
    this.invalidateDisplayCache();
    this.updateSortIndicators();
    this.preserveColumnWidths();
    if (this.pagination) {
      this.pagination.currentPage = 1;
      this.pagination.render();
    }
    this.updateTbody();
  }
  getSortState() {
    return this.sortState;
  }
  updateSortIndicators() {
    if (!this.container) return;
    const headerRow = this.container.querySelector("thead tr");
    if (!headerRow) return;
    const visibleColumns = this.getVisibleColumns();
    const ths = headerRow.querySelectorAll("th");
    for (let i = 0; i < ths.length; i++) {
      const th = ths[i];
      const column = visibleColumns[i];
      if (!column || !this.isColumnObjectSortable(column)) continue;
      const direction = this.getSortDirectionFor(column.id);
      th.setAttribute("aria-sort", direction);
      const oldIndicator = th.querySelector(".table-sort-indicator");
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
  syncSearchInput(columnId) {
    if (!this.container) return;
    const input = this.container.querySelector(`thead input[data-column-id="${columnId}"]`);
    if (input) input.value = this.filters[columnId] ?? "";
  }
  renderColumnSelector() {
    const selector = this.columnSelector;
    if (!selector?.container) return;
    selector.container.replaceChildren();
    const renderFn = selector.render ?? defaultColumnSelector;
    const element = renderFn({
      columns: this.options.columns,
      toggleColumn: (columnId) => this.toggleColumn(columnId)
    });
    selector.container.appendChild(element);
  }
  toggleColumn(columnId) {
    const column = this.getColumn(columnId);
    if (!column) return;
    column.visible = column.visible === false ? true : false;
    let resizable;
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
  render(container) {
    this.container = container;
    this.addPlugins();
    this.addComponents();
    return this.update();
  }
  update() {
    this.container.replaceChildren();
    this.container.appendChild(this.renderThead());
    this.container.appendChild(this.renderTbody());
    if (this.columnSelector) this.renderColumnSelector();
    if (this.pagination) this.pagination.render();
    return this.container;
  }
  updateTbody() {
    this.container.querySelector("tbody")?.remove();
    this.container.appendChild(this.renderTbody());
  }
  getRowElement(index) {
    return this.container.querySelector(`tbody > tr[data-row-index="${index}"]`) ?? void 0;
  }
  getPageForIndex(index) {
    if (!this.pagination) return 1;
    return Math.floor(index / this.pagination.pagination.pageSize) + 1;
  }
  destroy() {
    const plugins = this.plugins;
    for (let i = 0; i < plugins.length; i++) {
      plugins[i].removeEventListeners();
    }
    this.pagination?.removeEventListeners();
    for (const timer of Object.values(this.searchDebounceTimers)) {
      globalThis.clearTimeout(timer);
    }
  }
};
var Cell = class {
  collisionWidth = 10;
  findCell(event, tagNames) {
    const targets = document.elementsFromPoint(event.clientX, event.clientY);
    for (let i = 0; i < targets.length; i++) {
      const node = targets[i];
      if (tagNames.includes(node.tagName.toLowerCase())) {
        return node;
      }
    }
    return void 0;
  }
  getHoverStatus(event, cell) {
    if (!cell) return "out";
    const { left, right } = cell.getBoundingClientRect();
    if (event.clientX <= left + this.collisionWidth) return "left";
    if (right - this.collisionWidth <= event.clientX) return "right";
    return "in";
  }
  findIndex(cells, cell) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === cell) return i;
    }
    return -1;
  }
};
var Editable = class extends Cell {
  table;
  onPointerDown;
  onBlur;
  constructor(table) {
    super();
    this.table = table;
    this.onPointerDown = this.editCell.bind(this);
    this.onBlur = this.saveCell.bind(this);
  }
  addEventListeners() {
    this.table.container.addEventListener("pointerdown", this.onPointerDown);
    this.table.container.addEventListener("blur", this.onBlur, true);
  }
  removeEventListeners() {
    this.table.container.removeEventListener("pointerdown", this.onPointerDown);
    this.table.container.removeEventListener("blur", this.onBlur, true);
  }
  editCell(event) {
    const cell = this.findCell(event, [
      "td"
    ]);
    if (!cell) return;
    cell.contentEditable = "true";
    cell.focus();
  }
  saveCell(event) {
    const cell = event.target.closest("td");
    if (!cell) return;
    cell.contentEditable = "false";
  }
};
var Resizable = class extends Cell {
  resizingCells = null;
  table;
  onPointerMove;
  onPointerDown;
  onPointerUp;
  onResize;
  constructor(table) {
    super();
    this.table = table;
    this.onPointerMove = this.hoverCellBorder.bind(this);
    this.onPointerDown = this.resizeStartCell.bind(this);
    this.onPointerUp = this.resizeEndCell.bind(this);
    this.onResize = this.reset.bind(this);
  }
  addEventListeners() {
    this.table.container.style.tableLayout = "auto";
    this.table.container.addEventListener("pointermove", this.onPointerMove);
    this.table.container.addEventListener("pointerdown", this.onPointerDown);
    this.table.container.addEventListener("pointerup", this.onPointerUp);
    globalThis.addEventListener("resize", this.onResize);
  }
  removeEventListeners() {
    this.table.container.style.tableLayout = "inherit";
    this.table.container.removeEventListener("pointermove", this.onPointerMove);
    this.table.container.removeEventListener("pointerdown", this.onPointerDown);
    this.table.container.removeEventListener("pointerup", this.onPointerUp);
    globalThis.removeEventListener("resize", this.onResize);
  }
  reset() {
    this.table.container.style.tableLayout = "auto";
    const headers = this.table.container.querySelectorAll("thead th");
    for (let i = 0; i < headers.length; i++) {
      const th = headers[i];
      th.style.boxSizing = "";
      th.style.width = "";
      th.style.minWidth = "";
      th.style.maxWidth = "";
    }
  }
  setPointerStyle(event, cell) {
    const status = this.getHoverStatus(event, cell);
    this.table.container.style.cursor = status === "left" || status === "right" ? "col-resize" : "inherit";
  }
  resizeStartCell(event) {
    const cell = this.findCell(event, [
      "th"
    ]);
    if (!cell) return;
    const status = this.getHoverStatus(event, cell);
    if (status === "in") return;
    const row = cell.parentNode;
    if (!row.closest("thead") || row !== row.closest("thead").rows[0]) return;
    cell.setPointerCapture(event.pointerId);
    const columns = row.getElementsByTagName("th");
    const index = this.findIndex(columns, cell);
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i];
      const w = column.getBoundingClientRect().width;
      column.style.boxSizing = "border-box";
      column.style.width = `${w}px`;
    }
    this.resizingCells = status === "left" ? {
      left: columns[index - 1],
      right: cell
    } : {
      left: cell,
      right: columns[index + 1]
    };
  }
  resizeEndCell() {
    this.resizingCells = null;
  }
  hoverCellBorder(event) {
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
    const cell = this.findCell(event, [
      "th"
    ]);
    this.setPointerStyle(event, cell);
  }
};
var Sortable = class extends Cell {
  sorting = false;
  resizable;
  pointerDownCell = null;
  table;
  onPointerDown;
  onPointerUp;
  onKeyDown;
  constructor(table, options) {
    super();
    this.table = table;
    this.resizable = options?.resizable;
    this.onPointerDown = this.handlePointerDown.bind(this);
    this.onPointerUp = this.sortRows.bind(this);
    this.onKeyDown = this.handleKeyDown.bind(this);
  }
  addEventListeners() {
    this.table.container.addEventListener("pointerdown", this.onPointerDown);
    this.table.container.addEventListener("pointerup", this.onPointerUp);
    this.table.container.addEventListener("keydown", this.onKeyDown);
  }
  removeEventListeners() {
    this.table.container.removeEventListener("pointerdown", this.onPointerDown);
    this.table.container.removeEventListener("pointerup", this.onPointerUp);
    this.table.container.removeEventListener("keydown", this.onKeyDown);
  }
  resolveHeaderColumnId(cell) {
    const row = cell.parentNode;
    if (!row.closest("thead") || row !== row.closest("thead").rows[0]) {
      return void 0;
    }
    const columns = row.getElementsByTagName("th");
    const index = this.findIndex(columns, cell);
    const column = this.table.getVisibleColumns()[index];
    if (!column || !this.table.isColumnObjectSortable(column)) return void 0;
    return column.id;
  }
  handlePointerDown(event) {
    const interactive = event.target.closest("input, textarea, select, button, [data-no-sort]");
    if (interactive) return;
    const cell = this.findCell(event, [
      "th"
    ]);
    if (!cell) return;
    const columnId = this.resolveHeaderColumnId(cell);
    if (!columnId) return;
    const status = this.getHoverStatus(event, cell);
    if (this.resizable && status !== "in") return;
    this.pointerDownCell = cell;
  }
  sortRows(event) {
    if (this.sorting) return;
    if (!this.pointerDownCell) return;
    const interactive = event.target.closest("input, textarea, select, button, [data-no-sort]");
    if (interactive) {
      this.pointerDownCell = null;
      return;
    }
    const cell = this.findCell(event, [
      "th"
    ]);
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
  handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const cell = event.target.closest("th");
    if (!cell) return;
    const columnId = this.resolveHeaderColumnId(cell);
    if (!columnId) return;
    event.preventDefault();
    this.table.sortBy(columnId);
  }
};
var Pagination = class {
  table;
  pagination;
  currentPage = 1;
  onClick;
  constructor(table) {
    this.table = table;
    this.pagination = table.options.components.pagination;
    this.onClick = this.handleClick.bind(this);
    this.addEventListeners();
  }
  addEventListeners() {
    this.pagination.container?.addEventListener("click", this.onClick);
  }
  removeEventListeners() {
    this.pagination.container?.removeEventListener("click", this.onClick);
  }
  getTotalPages() {
    return Math.ceil(this.table.getDisplayData().length / this.pagination.pageSize);
  }
  handleClick(event) {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    const page = button.dataset["page"];
    let target;
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
  goToPage(page) {
    const total = this.getTotalPages();
    this.currentPage = Math.min(Math.max(page, 1), total);
    this.table.updateTbody();
    this.render();
  }
  render() {
    const { container } = this.pagination;
    if (!container) return;
    container.replaceChildren();
    const renderFn = this.pagination.render ?? defaultPagination;
    const element = renderFn({
      currentPage: this.currentPage,
      totalPages: this.getTotalPages(),
      maxPageButtons: this.pagination.maxPageButtons
    });
    container.appendChild(element);
  }
};
function defaultPagination({ currentPage, totalPages, maxPageButtons }) {
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Page navigation");
  const ul = document.createElement("ul");
  ul.className = "pagination";
  const createItem = (label, page, disabled = false, active = false) => {
    const li = document.createElement("li");
    li.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
    const button = document.createElement("button");
    button.className = "page-link";
    button.textContent = label;
    button.dataset["page"] = String(page);
    if (disabled) button.disabled = true;
    li.appendChild(button);
    return li;
  };
  const createArrowItem = (ariaLabel, page, symbol, disabled = false) => {
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
  const createEllipsis = () => {
    const li = document.createElement("li");
    li.className = "page-item disabled";
    const span = document.createElement("span");
    span.className = "page-link";
    span.textContent = "\u2026";
    li.appendChild(span);
    return li;
  };
  const pageNumbers = (() => {
    if (!maxPageButtons || totalPages <= maxPageButtons) {
      return {
        start: 1,
        end: totalPages
      };
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
    return {
      start,
      end
    };
  })();
  ul.appendChild(createArrowItem("Previous", "prev", "&laquo;", currentPage === 1));
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
  ul.appendChild(createArrowItem("Next", "next", "&raquo;", currentPage === totalPages));
  nav.appendChild(ul);
  return nav;
}
function defaultSortIndicator(direction) {
  const span = document.createElement("span");
  span.setAttribute("aria-hidden", "true");
  span.style.display = "inline-block";
  span.style.marginLeft = "0.3em";
  span.style.visibility = direction === "none" ? "hidden" : "visible";
  span.style.transform = direction === "descending" ? "rotate(180deg)" : "rotate(0deg)";
  span.innerHTML = `<svg viewBox="0 0 10 6" width="10" height="6" fill="currentColor" style="display:block"><path d="M5 0 L10 6 H0 Z"/></svg>`;
  return span;
}
function defaultColumnSelector({ columns, toggleColumn }) {
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
export {
  Editable,
  Pagination,
  Resizable,
  Sortable,
  Table,
  defaultColumnSelector,
  defaultPagination,
  defaultSortIndicator
};
