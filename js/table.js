/* =====================================================================
   TABLE — a small reusable sortable / searchable / paginated table
   renderer used by every view (avoids re-implementing this per screen).
   ===================================================================== */

const tableState = {}; // per-table-id: { sortCol, sortDir, search, page }

function renderDataTable(containerId, { columns, rows, pageSize = 12, onRowClick, searchPlaceholder, title }) {
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
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
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

    container.innerHTML = `
      <div class="table-toolbar">
        <div>${title ? `<strong style="font-size:12.5px;color:var(--ink-soft)">${data.length.toLocaleString('en-IN')} rows</strong>` : ""}</div>
        ${searchHtml}
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>${columns.map(c => `<th data-key="${c.key}">${c.label}${state.sortCol === c.key ? (state.sortDir === 1 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
          <tbody>
            ${pageRows.length ? pageRows.map((r, i) => `<tr data-idx="${state.page * pageSize + i}">${columns.map(c => `<td class="${c.numeric ? 'num' : ''}">${c.render ? c.render(r) : (r[c.key] ?? "—")}</td>`).join("")}</tr>`).join("")
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
    const searchInput = container.querySelector(".table-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => { state.search = e.target.value; state.page = 0; draw(); });
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
