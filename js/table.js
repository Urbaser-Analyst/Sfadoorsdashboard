/* =====================================================================
   TABLE — a small reusable sortable / searchable / paginated table
   renderer used by every view (avoids re-implementing this per screen).
   ===================================================================== */

const tableState = {}; // per-table-id: { sortCol, sortDir, search, page }

function stripExportHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function downloadExcelFile(fileName, columns, rows) {
  const exportRows = rows.map(row => {
    const out = {};
    columns.forEach(column => {
      const raw = column.numeric && Number.isFinite(Number(row[column.key])) ? Number(row[column.key]) : stripExportHtml(column.render ? column.render(row) : (row[column.key] ?? ""));
      out[column.label] = raw === "" ? "" : raw;
    });
    return out;
  });
  const safeName = String(fileName || "dashboard_report").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "dashboard_report";
  if (window.XLSX) {
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet["!cols"] = columns.map(column => ({ wch: Math.min(36, Math.max(12, String(column.label).length + 3)) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
    XLSX.writeFile(workbook, `${safeName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    return;
  }
  const csv = [columns.map(c => `"${String(c.label).replace(/"/g, '""')}"`).join(",")]
    .concat(exportRows.map(row => columns.map(c => `"${String(row[c.label] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function formatTableNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function renderDataTable(containerId, { columns, rows, pageSize = 12, onRowClick, searchPlaceholder, title, exportName }) {
  const state = (tableState[containerId] = tableState[containerId] || { sortCol: null, sortDir: 1, search: "", page: 0 });
  const container = document.getElementById(containerId);

  function apply() {
    let data = rows;
    if (state.search) {
      const q = state.search.toLowerCase();
      data = data.filter(r => columns.some(c => String(r[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (state.sortCol) {
      const col = state.sortCol, dir = state.sortDir;
      data = data.slice().sort((a, b) => {
        const va = a[col], vb = b[col];
        const vaEmpty = va === null || va === undefined || va === "";
        const vbEmpty = vb === null || vb === undefined || vb === "";
        if (vaEmpty && vbEmpty) return 0;
        if (vaEmpty) return 1;
        if (vbEmpty) return -1;
        // Dates must sort chronologically, not as strings (Date#toString()
        // starts with the weekday/month name, so "Aug" would alphabetically
        // sort before "Jan" — the opposite of calendar order).
        if (va instanceof Date || vb instanceof Date) {
          const ta = va instanceof Date ? va.getTime() : new Date(va).getTime();
          const tb = vb instanceof Date ? vb.getTime() : new Date(vb).getTime();
          const taBad = isNaN(ta), tbBad = isNaN(tb);
          if (taBad && tbBad) return 0;
          if (taBad) return 1;
          if (tbBad) return -1;
          return (ta - tb) * dir;
        }
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }
    return data;
  }

  function draw() {
    const data = apply();
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    state.page = Math.min(state.page, totalPages - 1);
    const pageRows = data.slice(state.page * pageSize, (state.page + 1) * pageSize);

    const searchHtml = searchPlaceholder !== false ? `<input type="text" class="table-search" placeholder="${searchPlaceholder || 'Search…'}" value="${state.search.replace(/"/g,'&quot;')}">` : "<span></span>";

    // The whole toolbar (including the search <input>) gets rebuilt below on
    // every keystroke. A fresh <input> element steals focus away from the
    // user, which is what made typing in the search box feel "broken" —
    // remember focus/cursor position here and restore it after the redraw.
    const prevSearchEl = container.querySelector(".table-search");
    const hadFocus = !!prevSearchEl && document.activeElement === prevSearchEl;
    const caretPos = hadFocus ? prevSearchEl.selectionStart : null;

    container.innerHTML = `
      <div class="table-toolbar">
        <div class="table-toolbar-left">${title ? `<strong style="font-size:12.5px;color:var(--ink-soft)">${data.length.toLocaleString('en-IN')} rows</strong>` : ""}<button type="button" class="btn btn-outline btn-sm table-export-btn">Download Excel</button></div>
        ${searchHtml}
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${columns.map(c => `<th data-key="${c.key}">${c.label}${state.sortCol === c.key ? (state.sortDir === 1 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
          <tbody>
            ${pageRows.length ? pageRows.map((r, i) => `<tr data-idx="${state.page * pageSize + i}">${columns.map(c => `<td class="${c.numeric ? 'num' : ''}">${c.render ? c.render(r) : (c.numeric ? formatTableNumber(r[c.key]) : (r[c.key] ?? "—"))}</td>`).join("")}</tr>`).join("")
              : `<tr><td colspan="${columns.length}" class="empty-note">No rows match the current filters.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Page ${state.page + 1} of ${totalPages}</span>
        <button data-nav="prev" ${state.page === 0 ? "disabled" : ""}>‹ Prev</button>
        <button data-nav="next" ${state.page >= totalPages - 1 ? "disabled" : ""}>Next ›</button>
      </div>
    `;

    container.querySelectorAll("th[data-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (state.sortCol === key) state.sortDir *= -1; else { state.sortCol = key; state.sortDir = 1; }
        draw();
      });
    });
    const exportButton = container.querySelector(".table-export-btn");
    if (exportButton) exportButton.addEventListener("click", () => downloadExcelFile(exportName || containerId, columns, data));
    const searchInput = container.querySelector(".table-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => { state.search = e.target.value; state.page = 0; draw(); });
      if (hadFocus) {
        searchInput.focus();
        try { searchInput.setSelectionRange(caretPos, caretPos); } catch (err) { /* ignore */ }
      }
    }
    container.querySelectorAll("[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => { state.page += btn.dataset.nav === "next" ? 1 : -1; draw(); });
    });
    if (onRowClick) {
      container.querySelectorAll("tbody tr[data-idx]").forEach(tr => {
        tr.addEventListener("click", () => onRowClick(data[+tr.dataset.idx]));
      });
    }
  }

  draw();
}
