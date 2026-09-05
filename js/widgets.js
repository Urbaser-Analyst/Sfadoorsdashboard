/* =====================================================================
   WIDGETS — small reusable UI controls shared across views.
   Currently: the global Customer filter, a searchable multiselect
   dropdown (checkbox list behind a search box, with chip-style summary
   on the toggle button).
   ===================================================================== */

// Normalized customer keys currently selected in the global Customer filter.
// Empty set = "All customers" (no filtering).
let SELECTED_CUSTOMER_KEYS = new Set();
let CUSTOMER_MS_OPTIONS = []; // [{ key, name }]

function customerMsLabel() {
  if (SELECTED_CUSTOMER_KEYS.size === 0) return "All customers";
  if (SELECTED_CUSTOMER_KEYS.size === 1) {
    const key = Array.from(SELECTED_CUSTOMER_KEYS)[0];
    const opt = CUSTOMER_MS_OPTIONS.find(o => o.key === key);
    return opt ? opt.name : "1 selected";
  }
  return `${SELECTED_CUSTOMER_KEYS.size} customers selected`;
}

function renderCustomerMsOptions(filterText) {
  const list = document.getElementById("customerMsOptions");
  if (!list) return;
  const q = (filterText || "").trim().toLowerCase();
  const filtered = q ? CUSTOMER_MS_OPTIONS.filter(o => o.name.toLowerCase().includes(q)) : CUSTOMER_MS_OPTIONS;

  if (!filtered.length) {
    list.innerHTML = `<div class="ms-empty">No customers match "${filterText}".</div>`;
    return;
  }
  list.innerHTML = filtered.map(o => `
    <label class="ms-option">
      <input type="checkbox" value="${o.key}" ${SELECTED_CUSTOMER_KEYS.has(o.key) ? "checked" : ""}>
      <span>${o.name}</span>
    </label>`).join("");

  list.querySelectorAll("input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) SELECTED_CUSTOMER_KEYS.add(cb.value); else SELECTED_CUSTOMER_KEYS.delete(cb.value);
      const toggle = document.getElementById("customerMsToggle");
      if (toggle) toggle.textContent = customerMsLabel() + " ▾";
      if (typeof DB !== "undefined" && DB) renderApp(DB);
    });
  });
}

function resetCustomerMultiSelect() {
  SELECTED_CUSTOMER_KEYS.clear();
  const toggle = document.getElementById("customerMsToggle");
  if (toggle) toggle.textContent = customerMsLabel() + " ▾";
  const searchInput = document.getElementById("customerMsSearch");
  if (searchInput) searchInput.value = "";
  renderCustomerMsOptions("");
}

function initCustomerMultiSelect(DBRef) {
  CUSTOMER_MS_OPTIONS = (DBRef.customerNameList || [])
    .map(name => ({ key: normName(name), name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Drop any previously-selected keys that no longer exist after a refresh.
  Array.from(SELECTED_CUSTOMER_KEYS).forEach(k => {
    if (!CUSTOMER_MS_OPTIONS.some(o => o.key === k)) SELECTED_CUSTOMER_KEYS.delete(k);
  });

  const toggle = document.getElementById("customerMsToggle");
  const panel = document.getElementById("customerMsPanel");
  const searchInput = document.getElementById("customerMsSearch");
  if (!toggle || !panel || !searchInput) return;

  toggle.textContent = customerMsLabel() + " ▾";
  renderCustomerMsOptions(searchInput.value);

  if (toggle.dataset.wired) return; // wire event listeners once only
  toggle.dataset.wired = "1";

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) searchInput.focus();
  });
  searchInput.addEventListener("click", (e) => e.stopPropagation());
  searchInput.addEventListener("input", () => renderCustomerMsOptions(searchInput.value));
  document.getElementById("customerMsPanel").addEventListener("click", (e) => e.stopPropagation());

  const clearBtn = document.getElementById("customerMsClear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetCustomerMultiSelect();
    if (typeof DB !== "undefined" && DB) renderApp(DB);
  });
  const doneBtn = document.getElementById("customerMsDone");
  if (doneBtn) doneBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = true;
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("customerMsDropdown");
    if (wrap && !wrap.contains(e.target)) panel.hidden = true;
  });
}

/* ================= GENERIC NATIVE MULTISELECT (used by Product Analysis slicers) ================= */
function multiSelectHtml(id, options, selectedSet) {
  const size = Math.min(6, Math.max(3, options.length || 1));
  return `<select id="${id}" multiple size="${size}">${
    options.map(o => `<option value="${String(o).replace(/"/g, '&quot;')}" ${selectedSet.has(o) ? "selected" : ""}>${o}</option>`).join("")
  }</select>`;
}

/* =====================================================================
   SINGLE-SELECT SEARCHABLE DROPDOWN — for pickers where exactly one value
   is chosen (e.g. Quotation's Customer / Order selectors), as opposed to
   the multiselect widgets above. Click an option and the panel closes.
   Built as real DOM (not a native <input list> datalist), because
   <datalist> has no suggestion UI at all on iOS/Safari and requires an
   exact text match to register a selection — both made the Quotation
   picker feel broken on phones.
   ===================================================================== */
function singleSelectHtml(idPrefix, label, placeholder) {
  return `
    <div class="filter-group">
      <label>${label}</label>
      <div class="ms-dropdown" id="${idPrefix}Dropdown">
        <button type="button" class="ms-toggle" id="${idPrefix}Toggle">${placeholder || "Select…"} ▾</button>
        <div class="ms-panel" id="${idPrefix}Panel" hidden>
          <input type="text" class="ms-search" id="${idPrefix}Search" placeholder="Search…" autocomplete="off">
          <div class="ms-options" id="${idPrefix}Options"></div>
        </div>
      </div>
    </div>`;
}

// options: [{ value, label }]. selectedValue: current value (or "").
function singleSelectRender(idPrefix, options, selectedValue, placeholder) {
  const toggle = document.getElementById(idPrefix + "Toggle");
  const list = document.getElementById(idPrefix + "Options");
  const search = document.getElementById(idPrefix + "Search");
  if (!toggle || !list) return;

  const q = (search && search.value || "").trim().toLowerCase();
  const visible = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options;

  list.innerHTML = visible.length ? visible.map(o => `
    <label class="ms-option ms-option-single ${o.value === selectedValue ? 'ms-option-selected' : ''}" data-value="${String(o.value).replace(/"/g, '&quot;')}">
      <span>${o.label}</span>
    </label>`).join("") : `<div class="ms-empty">No matches.</div>`;

  const selected = options.find(o => o.value === selectedValue);
  toggle.textContent = (selected ? selected.label : (placeholder || "Select…")) + " ▾";
  toggle.disabled = options.length === 0;
}

function singleSelectWire(idPrefix, getOptions, getSelected, onSelect, placeholder) {
  const toggle = document.getElementById(idPrefix + "Toggle");
  const panel = document.getElementById(idPrefix + "Panel");
  const search = document.getElementById(idPrefix + "Search");
  const list = document.getElementById(idPrefix + "Options");
  if (!toggle || !panel || !list) return;

  singleSelectRender(idPrefix, getOptions(), getSelected(), placeholder);
  if (toggle.dataset.wired) return;
  toggle.dataset.wired = "1";

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (toggle.disabled) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden && search) search.focus();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  if (search) search.addEventListener("input", () => singleSelectRender(idPrefix, getOptions(), getSelected(), placeholder));
  list.addEventListener("click", (e) => {
    const row = e.target.closest("[data-value]");
    if (!row) return;
    panel.hidden = true;
    onSelect(row.dataset.value);
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById(idPrefix + "Dropdown");
    if (wrap && !wrap.contains(e.target)) panel.hidden = true;
  });
}

/* ================= RADIO GROUP (Credit / Paid / All slicers, etc.) ================= */
function radioGroupHtml(name, options, selectedValue) {
  return `<div class="radio-pill-group">${
    options.map(o => `
      <label class="radio-pill ${selectedValue === o.value ? 'active' : ''}">
        <input type="radio" name="${name}" value="${o.value}" ${selectedValue === o.value ? "checked" : ""}>
        <span>${o.label}</span>
      </label>`).join("")
  }</div>`;
}

/* =====================================================================
   CASCADING SEARCHABLE MULTISELECT FIELD — a fuller version of the widget
   above, generalized with an id prefix so multiple independent instances
   can exist on one page (used for the Product Analysis slicers, and any
   other multi-field "Excel slicer"-style filter set). Each instance has:
   a search box, a "Select All" row, and a checkbox per option. Options are
   supplied fresh on every render by the caller (msFieldRender), so callers
   can implement cascading/dependent filtering by recomputing the option
   list from the other fields' current selections before each render.
   ===================================================================== */
function msFieldHtml(idPrefix, label) {
  return `
    <div class="filter-group">
      <label>${label}</label>
      <div class="ms-dropdown" id="${idPrefix}Dropdown">
        <button type="button" class="ms-toggle" id="${idPrefix}Toggle">All ▾</button>
        <div class="ms-panel" id="${idPrefix}Panel" hidden>
          <input type="text" class="ms-search" id="${idPrefix}Search" placeholder="Search ${label.toLowerCase()}…" autocomplete="off">
          <label class="ms-option ms-select-all"><input type="checkbox" id="${idPrefix}SelectAll"><span>Select All</span></label>
          <div class="ms-options" id="${idPrefix}Options"></div>
        </div>
      </div>
    </div>`;
}

function msFieldRender(idPrefix, options, selectedSet) {
  const toggle = document.getElementById(idPrefix + "Toggle");
  const list = document.getElementById(idPrefix + "Options");
  const selectAll = document.getElementById(idPrefix + "SelectAll");
  const search = document.getElementById(idPrefix + "Search");
  if (!toggle || !list) return;

  const q = (search && search.value || "").trim().toLowerCase();
  const visible = q ? options.filter(o => String(o).toLowerCase().includes(q)) : options;

  list.innerHTML = visible.length ? visible.map(o => `
    <label class="ms-option">
      <input type="checkbox" value="${String(o).replace(/"/g, '&quot;')}" ${selectedSet.has(o) ? "checked" : ""}>
      <span>${o}</span>
    </label>`).join("") : `<div class="ms-empty">No matches.</div>`;

  if (selectAll) selectAll.checked = options.length > 0 && options.every(o => selectedSet.has(o));
  const label = options.length === 0 ? "No options"
    : selectedSet.size === 0 ? "All"
    : selectedSet.size === options.length ? `All (${options.length})`
    : `${selectedSet.size} selected`;
  toggle.textContent = label + " ▾";
}

function msFieldWire(idPrefix, getOptions, selectedSet, onChange) {
  const toggle = document.getElementById(idPrefix + "Toggle");
  const panel = document.getElementById(idPrefix + "Panel");
  const search = document.getElementById(idPrefix + "Search");
  const selectAll = document.getElementById(idPrefix + "SelectAll");
  const list = document.getElementById(idPrefix + "Options");
  if (!toggle || !panel || !list) return;

  msFieldRender(idPrefix, getOptions(), selectedSet);
  if (toggle.dataset.wired) return; // wire event listeners once only, ever
  toggle.dataset.wired = "1";

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden && search) search.focus();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  if (search) search.addEventListener("input", () => msFieldRender(idPrefix, getOptions(), selectedSet));
  if (selectAll) selectAll.addEventListener("change", () => {
    const opts = getOptions();
    if (selectAll.checked) opts.forEach(o => selectedSet.add(o)); else opts.forEach(o => selectedSet.delete(o));
    onChange();
  });
  list.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    if (e.target.checked) selectedSet.add(e.target.value); else selectedSet.delete(e.target.value);
    onChange();
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById(idPrefix + "Dropdown");
    if (wrap && !wrap.contains(e.target)) panel.hidden = true;
  });
}

/* Standard cascading-filter engine: given the full line set and a list of
   { key, field } slicer definitions plus a { key: Set } selections object,
   returns the valid option list per field (computed against every OTHER
   field's current selection, Excel-slicer style) and the fully-filtered
   line set. Invalid selections (no longer possible given the other filters)
   are pruned automatically so dropdowns never contradict each other. */
function computeCascadingSlicers(lines, fieldDefs, selections) {
  function lineMatches(line, skipKey) {
    return fieldDefs.every(fd => {
      if (fd.key === skipKey) return true;
      const sel = selections[fd.key];
      return !sel || sel.size === 0 || sel.has(line[fd.field]);
    });
  }
  let optionsByField = {};
  fieldDefs.forEach(fd => {
    optionsByField[fd.key] = Array.from(new Set(lines.filter(l => lineMatches(l, fd.key)).map(l => l[fd.field]).filter(Boolean))).sort();
  });
  let pruned = false;
  fieldDefs.forEach(fd => {
    const valid = new Set(optionsByField[fd.key]);
    const sel = selections[fd.key];
    if (sel && sel.size) {
      Array.from(sel).forEach(v => { if (!valid.has(v)) { sel.delete(v); pruned = true; } });
    }
  });
  if (pruned) {
    fieldDefs.forEach(fd => {
      optionsByField[fd.key] = Array.from(new Set(lines.filter(l => lineMatches(l, fd.key)).map(l => l[fd.field]).filter(Boolean))).sort();
    });
  }
  const filteredLines = lines.filter(l => lineMatches(l, null));
  return { optionsByField, filteredLines };
}
