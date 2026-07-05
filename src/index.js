import { Table, Sortable, Resizable, Editable } from "./table.js";
import hljs from "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/es/highlight.min.js";
import javascript from "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/es/languages/javascript.min.js";

const highlightjsURL =
  "https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.11.1/build/styles/";
const lightThemeURL = highlightjsURL + "default.min.css";
const darkThemeURL = highlightjsURL + "dark.min.css";

applyHighlightjsTheme(localStorage.getItem("darkMode") ?? "light");

function toggleDarkMode() {
  const html = document.documentElement;
  const newTheme = html.getAttribute("data-bs-theme") === "dark"
    ? "light"
    : "dark";
  html.setAttribute("data-bs-theme", newTheme);
  localStorage.setItem("darkMode", newTheme);

  applyHighlightjsTheme(newTheme);
}

function applyHighlightjsTheme(theme) {
  document.getElementById("highlightjs-theme").href = theme === "dark"
    ? darkThemeURL
    : lightThemeURL;
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function tracks() {
  return [
    { id: 1, title: "Sunrise Drift", artist: "Nova Bloom", album: "Halcyon", duration: 214, plays: 128400, releasedAt: "2019-03-12" },
    { id: 2, title: "Glass Corridor", artist: "Kite Season", album: "Static Bloom", duration: 187, plays: 54210, releasedAt: "2021-07-04" },
    { id: 3, title: "Low Tide", artist: "Nova Bloom", album: "Halcyon", duration: 251, plays: 302110, releasedAt: "2019-03-12" },
    { id: 4, title: "Paper Moths", artist: "Ferra Vale", album: "Paper Moths EP", duration: 163, plays: 18900, releasedAt: "2023-01-20" },
    { id: 5, title: "Static Bloom", artist: "Kite Season", album: "Static Bloom", duration: 229, plays: 76210, releasedAt: "2021-07-04" },
    { id: 6, title: "Copper Skyline", artist: "Ferra Vale", album: "Paper Moths EP", duration: 198, plays: 44100, releasedAt: "2023-01-20" },
  ];
}

function manyTracks(count = 23) {
  const artists = ["Nova Bloom", "Kite Season", "Ferra Vale", "Salt Orchard", "Glass Antlers"];
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Track ${i + 1}`,
    artist: artists[i % artists.length],
    album: `Album ${1 + (i % 4)}`,
    duration: 140 + ((i * 17) % 160),
    plays: 900 + i * 733,
    releasedAt: `20${18 + (i % 6)}-0${1 + (i % 9)}-1${i % 9}`,
  }));
}

function basicColumns() {
  return [
    { id: "title", name: "Title" },
    { id: "artist", name: "Artist" },
    {
      id: "duration",
      name: "Duration",
      render: (row, td) => { td.textContent = formatDuration(row.duration); },
    },
  ];
}

// 1. Basic table
new Table({
  data: tracks(),
  columns: basicColumns(),
}).render(document.querySelector("#table-basic"));

// 2. Sortable
(() => {
  const table = new Table({ data: tracks(), columns: basicColumns() });
  table.options.plugins = [new Sortable(table)];
  table.render(document.querySelector("#table-sortable"));
})();

// 3. Non-sortable column + custom compare
(() => {
  const columns = [
    { id: "title", name: "Title" },
    { id: "artist", name: "Artist" },
    {
      id: "releasedAt",
      name: "Released",
      compare: (a, b) => new Date(a.releasedAt).getTime() - new Date(b.releasedAt).getTime(),
    },
    {
      id: "actions",
      name: "",
      sortable: false,
      render: (row, td) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-sm btn-outline-danger";
        button.textContent = "Remove";
        button.addEventListener("click", () => alert(`Remove "${row.title}"?`));
        td.appendChild(button);
      },
    },
  ];
  const table = new Table({ data: tracks(), columns });
  table.options.plugins = [new Sortable(table)];
  table.render(document.querySelector("#table-actions"));
})();

// 4. Column search
new Table({
  data: tracks(),
  columns: basicColumns(),
  components: { columnSearch: { placeholder: "Search…" } },
}).render(document.querySelector("#table-search"));

// 5. Pagination
new Table({
  data: manyTracks(),
  columns: basicColumns(),
  components: {
    pagination: {
      pageSize: 5,
      container: document.querySelector("#pagination-basic"),
      maxPageButtons: 5,
    },
  },
}).render(document.querySelector("#table-pagination"));

// 6. Column selector
(() => {
  const table = new Table({
    data: tracks(),
    columns: [...basicColumns(), { id: "plays", name: "Plays" }],
    components: { columnSelector: { container: document.querySelector("#column-selector") } },
  });
  const resizable = new Resizable(table);
  table.options.plugins = [resizable];
  table.render(document.querySelector("#table-columns"));
})();

// 7. Resizable
(() => {
  const table = new Table({ data: tracks(), columns: basicColumns() });
  table.options.plugins = [new Resizable(table)];
  table.render(document.querySelector("#table-resizable"));
})();

// 8. Editable
(() => {
  const table = new Table({ data: tracks(), columns: basicColumns() });
  table.options.plugins = [new Editable(table)];
  table.render(document.querySelector("#table-editable"));
})();

// 9. Custom sort indicator
(() => {
  const table = new Table({
    data: tracks(),
    columns: basicColumns(),
    components: {
      sortIndicator: {
        render: (direction) => {
          if (direction === "none") return null;
          const span = document.createElement("span");
          span.textContent = direction === "ascending" ? " ▲" : " ▼";
          return span;
        },
      },
    },
  });
  table.options.plugins = [new Sortable(table)];
  table.render(document.querySelector("#table-custom-indicator"));
})();

// 10. setData()
(() => {
  const table = new Table({ data: tracks(), columns: basicColumns() });
  table.render(document.querySelector("#table-setdata"));

  let swapped = false;
  document.querySelector("#reload-data").addEventListener("click", () => {
    swapped = !swapped;
    table.setData(swapped ? manyTracks(6) : tracks());
  });
})();

// 11. Everything together
(() => {
  const columns = [...basicColumns(), { id: "plays", name: "Plays" }];
  const table = new Table({
    data: manyTracks(),
    columns,
    components: {
      columnSearch: { placeholder: "Search…" },
      pagination: {
        pageSize: 6,
        container: document.querySelector("#pagination-combined"),
        maxPageButtons: 5,
      },
      columnSelector: { container: document.querySelector("#column-selector-combined") },
    },
  });
  const resizable = new Resizable(table);
  table.options.plugins = [new Sortable(table, { resizable }), resizable];
  table.render(document.querySelector("#table-combined"));
})();

hljs.registerLanguage("javascript", javascript);
hljs.highlightAll();

document.getElementById("toggleDarkMode").onclick = toggleDarkMode;
