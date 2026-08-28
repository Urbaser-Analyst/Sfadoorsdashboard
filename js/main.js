/* =====================================================================
   MAIN — app bootstrap.
   ===================================================================== */

let DB = null;
let autoRefreshTimer = null;

function populateFilterOptions(DB) {
  const saeSelect = document.getElementById("f_sae");
  saeSelect.innerHTML = DB.saeList.map(s => `<option value="${s}">${s}</option>`).join("");

  const viaSelect = document.getElementById("f_paymentVia");
  viaSelect.innerHTML = `<option value="">All</option>` + DB.paymentViaList.map(v => `<option value="${v}">${v}</option>`).join("");

  const customerSelect = document.getElementById("f_customerSearch");
  customerSelect.innerHTML = `<option value="">All customers</option>` + DB.customerNameList
    .map(c => `<option value="${c}">${c}</option>`).join("");
}

function showError(err) {
  console.error(err);
  document.getElementById("loadingState").hidden = true;
  const errEl = document.getElementById("errorState");
  errEl.hidden = false;
  errEl.innerHTML = `
    <strong>Couldn't load live data.</strong>
    <p style="max-width:520px">${err.message || err}</p>
    <button class="btn" id="retryBtn">Try again</button>
  `;
  document.getElementById("retryBtn").addEventListener("click", loadAndRender);
}

async function loadAndRender() {
  document.getElementById("loadingState").hidden = false;
  document.getElementById("errorState").hidden = true;
  document.getElementById("viewRoot").hidden = true;
  try {
    const raw = await loadAllSheets();
    DB = buildModel(raw);
    populateFilterOptions(DB);
    document.getElementById("lastSync").textContent = "Live · last synced " + DB.generatedAt.toLocaleTimeString("en-IN");
    renderApp(DB);
  } catch (err) {
    showError(err);
  }
}

function wireControls() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      CURRENT_VIEW = btn.dataset.view;
      LAST_ACTIVE_BUCKET = null;
      if (DB) renderApp(DB);
    });
  });

  const filterIds = ["f_dateFrom", "f_dateTo", "f_customerSearch", "f_sae", "f_minValue", "f_paymentVia"];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener("input", () => { if (DB) renderApp(DB); });
    el.addEventListener("change", () => { if (DB) renderApp(DB); });
  });

  const ageingSlider = document.getElementById("f_ageing");
  ageingSlider.addEventListener("input", () => {
    document.getElementById("f_ageingValue").textContent = ageingSlider.value;
    if (DB) renderApp(DB);
  });

  document.getElementById("clearFiltersBtn").addEventListener("click", () => {
    document.getElementById("f_dateFrom").value = "";
    document.getElementById("f_dateTo").value = "";
    document.getElementById("f_customerSearch").value = "";
    Array.from(document.getElementById("f_sae").options).forEach(o => o.selected = false);
    document.getElementById("f_paymentVia").value = "";
    document.getElementById("f_minValue").value = "";
    document.getElementById("f_ageing").value = 0;
    document.getElementById("f_ageingValue").textContent = "0";
    if (DB) renderApp(DB);
  });

  const filterToggleBtn = document.getElementById("filterToggleBtn");
  if (filterToggleBtn) {
    filterToggleBtn.addEventListener("click", () => {
      document.getElementById("filterbar").classList.toggle("open");
    });
  }

  document.getElementById("refreshBtn").addEventListener("click", loadAndRender);

  document.getElementById("autoRefreshToggle").addEventListener("change", (e) => {
    if (e.target.checked) {
      autoRefreshTimer = setInterval(loadAndRender, CONFIG.AUTO_REFRESH_MS);
    } else if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireControls();
  initAuth(loadAndRender);
});
