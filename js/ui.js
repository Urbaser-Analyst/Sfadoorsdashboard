/* =====================================================================
   UI — renders each of the 7 views into #viewRoot based on the current
   filter state, and wires up the drill-down modal.
   ===================================================================== */

let CURRENT_VIEW = "summary";
let LAST_ACTIVE_BUCKET = null;

function groupSum(items, keyFn, valFn) {
  const map = {};
  items.forEach(it => { const k = keyFn(it); map[k] = (map[k] || 0) + valFn(it); });
  return map;
}
function topN(map, n) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function kpiCard(label, value, sub, accent) {
  return `<div class="kpi-card ${accent ? 'accent-' + accent : ''}">
    <div class="kpi-label">${label}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
  </div>`;
}

function statusTag(status) {
  const cls = status === "Paid" ? "tag-paid" : status === "Partially Paid" ? "tag-partial" : "tag-pending";
  return `<span class="tag ${cls}">${status}</span>`;
}

function renderApp(DB) {
  const f = readFilterState();
  document.getElementById("viewRoot").hidden = false;
  document.getElementById("loadingState").hidden = true;

  const view = CURRENT_VIEW;
  if (view === "summary") renderSummary(DB, f);
  else if (view === "outstanding") renderOutstanding(DB, f);
  else if (view === "ledger") renderLedger(DB, f);
  else if (view === "products") renderProducts(DB, f);
  else if (view === "payments") renderPayments(DB, f);
  else if (view === "returns") renderReturns(DB, f);
  else if (view === "creditpaid") renderCreditPaid(DB, f);
  else if (view === "raw") renderRaw(DB, f);
}

/* ================= EXECUTIVE SUMMARY ================= */
function renderSummary(DB, f) {
  const bills = filterBills(DB.bills, f);
  const payments = filterPayments(DB.payments, f);
  const returns = filterReturns(DB.stockReturns, f);
  const lines = filterOrderLines(DB.orderLines, f);

  const deliveredBills = bills.filter(b => b.isDelivered);
  // In Progress Value is a pipeline measure across all delivery dates.
  // Preserve non-date filters, but do not let the date slicer hide pipeline value.
  const billsWithoutDateFilter = filterBills(DB.bills, { ...f, dateFrom: null, dateTo: null });
  const inProgressBills = billsWithoutDateFilter.filter(b => !b.isDelivered);
  // Sales/order-value KPIs are delivered-only; pipeline is shown separately.
  const totalBilled = deliveredBills.reduce((s, b) => s + b.billValue, 0);
  const salesValue = totalBilled;
  const inProgressValue = inProgressBills.reduce((s, b) => s + b.billValue, 0);
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const totalOutstanding = bills.reduce((s, b) => s + b.pendingBalance, 0);
  const totalSurplus = new Set(bills.map(b => b.customerKey)).size
    ? Array.from(new Set(bills.map(b => b.customerKey))).reduce((s, k) => s + (DB.customerSurplusMap[k] || 0), 0) : 0;
  const totalReturned = returns.reduce((s, r) => s + r.amount, 0);
  const collectionPct = totalBilled > 0 ? ((totalCollected + totalReturned) / totalBilled * 100) : 0;
  const activeCustomers = new Set(bills.map(b => b.customerKey)).size;
  const avgOrderValue = deliveredBills.length ? totalBilled / deliveredBills.length : 0;

  const saeSalesMap = {};
  deliveredBills.forEach(b => { saeSalesMap[b.sae] = (saeSalesMap[b.sae] || 0) + b.billValue; });
  const saeSales = topN(saeSalesMap, 10).map(([sae, salesValue]) => ({ sae, salesValue }));

  const monthly = {};
  deliveredBills.forEach(b => { const k = monthKey(b.deliveryDate || b.billDate); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).sale += b.billValue; });
  payments.forEach(p => { const k = monthKey(p.date); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).pay += p.amount; });
  returns.forEach(r => { const k = monthKey(r.date); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).ret += r.amount; });
  const months = Object.keys(monthly).sort();

  const custRows = summarizeBillsByCustomer(bills, DB.customerSurplusMap).sort((a, b) => b.pendingTotal - a.pendingTotal).slice(0, 10);
  const productAgg = {};
  lines.filter(l => l.isDelivered).forEach(l => { const k = l.productName; (productAgg[k] = productAgg[k] || 0); productAgg[k] += l.amount; });
  const topProducts = topN(productAgg, 10);

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Sales Value (Delivered)", fmtRupee(salesValue), "Order Value · selected Delivery Date", "sage")}
      ${kpiCard("Delivered Orders", deliveredBills.length, "within selected Delivery Date", "sage")}
      ${kpiCard("In Progress Value", fmtRupee(inProgressValue), "all delivery dates", "amber")}
      ${kpiCard("In Progress Orders", inProgressBills.length, "all delivery dates", "amber")}
      ${kpiCard("Total Collected", fmtRupee(totalCollected), payments.length + " payments", "sage")}
      ${kpiCard("Outstanding (Excl. Surplus)", fmtRupee(totalOutstanding), activeCustomers + " customers with bills", "clay")}
      ${kpiCard("Outstanding (Incl. Surplus)", fmtRupee(totalOutstanding - totalSurplus), "Nets off customer advances")}
      ${kpiCard("Stock Returns", fmtRupee(totalReturned), returns.length + " return entries", "amber")}
      ${kpiCard("Collection %", collectionPct.toFixed(1) + "%", "paid + returned ÷ billed")}
      ${kpiCard("Avg. Bill Value", fmtRupee(avgOrderValue), "")}
    </div>
    <p class="small-note" style="margin-top:-10px;margin-bottom:16px">Sales Value and Order Value use the Order sheet's Delivery Date and include delivered orders only. In Progress cards remain independent of the global date range.</p>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Sales vs Payments vs Returns</div><div class="panel-note">Monthly, current filters</div></div>
      <div class="chart-wrap"><canvas id="chartTrend"></canvas></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">SAE-wise Sales (Delivered)</div><div class="panel-note">Sales value per Sales Executive, by the SAE on each order</div></div>
      <div class="chart-wrap"><canvas id="chartSaeSales"></canvas></div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Top 10 Customers by Outstanding</div><div class="panel-note">Click a bar for the bill-wise ledger</div></div>
        <div class="chart-wrap"><canvas id="chartTopCust"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Top 10 Products by Value</div><div class="panel-note">Dimension / color agnostic</div></div>
        <div class="chart-wrap"><canvas id="chartTopProd"></canvas></div>
      </div>
    </div>
  `;

  makeLineChart("chartTrend", months.map(monthLabel), [
    { label: "Sales", data: months.map(m => monthly[m].sale) },
    { label: "Payments", data: months.map(m => monthly[m].pay) },
    { label: "Returns", data: months.map(m => monthly[m].ret) }
  ]);

  makeBarChart("chartTopCust", custRows.map(c => c.customerName.slice(0, 22)), [
    { label: "Outstanding", data: custRows.map(c => c.pendingTotal) }
  ], { horizontal: true });
  document.getElementById("chartTopCust").onclick = (evt) => {
    const pts = chartInstances["chartTopCust"].getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
    if (pts.length) openCustomerLedger(DB, custRows[pts[0].index].customerKey);
  };

  makeBarChart("chartTopProd", topProducts.map(([name]) => name.slice(0, 22)), [
    { label: "Value", data: topProducts.map(([, v]) => v), backgroundColor: CHART_PALETTE[1] }
  ], { horizontal: true });

  makeBarChart("chartSaeSales", saeSales.map(s => s.sae), [
    { label: "Sales Value", data: saeSales.map(s => s.salesValue) }
  ]);
}

/* ================= CUSTOMER OUTSTANDING & AGEING ================= */
function renderOutstanding(DB, f) {
  const bills = filterBills(DB.bills, f);
  const custRows = summarizeBillsByCustomer(bills, DB.customerSurplusMap).sort((a, b) => b.pendingTotal - a.pendingTotal);

  const buckets = [0, 0, 0, 0];
  bills.forEach(b => { if (b.pendingBalance > 0.5) { const bi = ageingBucket(b.ageDays); if (bi !== null) buckets[bi] += b.pendingBalance; } });

  const totalExcl = custRows.reduce((s, c) => s + c.outstandingExcludingSurplus, 0);
  const totalIncl = custRows.reduce((s, c) => s + c.outstandingIncludingSurplus, 0);
  const totalSurplus = custRows.reduce((s, c) => s + c.surplus, 0);

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Outstanding (Excluding Surplus)", fmtRupee(totalExcl), "Sum of unpaid bills only", "clay")}
      ${kpiCard("Outstanding (Including Surplus)", fmtRupee(totalIncl), "Nets off customer advances — can go negative", "amber")}
      ${kpiCard("Total Customer Surplus/Advance", fmtRupee(totalSurplus), "Payments received beyond all known bills", "sage")}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Outstanding by Ageing Bucket</div><div class="panel-note">Click a bucket to filter the table below</div></div>
      <div class="bucket-row">
        ${AGEING_BUCKET_LABELS.map((l, i) => `
          <div class="bucket-chip bucket-${i} ${LAST_ACTIVE_BUCKET === i ? 'active' : ''}" data-bucket="${i}">
            <div class="n">${fmtRupee(buckets[i])}</div>
            <div class="l">${l}</div>
          </div>`).join("")}
      </div>
      <div class="grid-2">
        <div class="chart-wrap small"><canvas id="chartAgeingDonut"></canvas></div>
        <div class="chart-wrap small"><canvas id="chartAgeingBySae"></canvas></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Customer Outstanding (${custRows.length})</div>
        <div class="panel-note">Sum of unpaid bills per customer, after FIFO allocation of payments &amp; returns</div>
      </div>
      <div id="custTable"></div>
    </div>
  `;

  makeDoughnut("chartAgeingDonut", AGEING_BUCKET_LABELS, buckets, {
    onClick: (idx) => { LAST_ACTIVE_BUCKET = LAST_ACTIVE_BUCKET === idx ? null : idx; renderOutstanding(DB, f); }
  });

  const bySae = {};
  bills.forEach(b => { if (b.pendingBalance > 0.5) bySae[b.sae] = (bySae[b.sae] || 0) + b.pendingBalance; });
  const saeEntries = topN(bySae, 8);
  makeBarChart("chartAgeingBySae", saeEntries.map(e => e[0]), [{ label: "Outstanding", data: saeEntries.map(e => e[1]) }]);

  document.querySelectorAll(".bucket-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const b = +chip.dataset.bucket;
      LAST_ACTIVE_BUCKET = LAST_ACTIVE_BUCKET === b ? null : b;
      renderOutstanding(DB, f);
    });
  });

  let rows = custRows;
  if (LAST_ACTIVE_BUCKET !== null) rows = rows.filter(c => ageingBucket(c.oldestPendingAge) === LAST_ACTIVE_BUCKET);

  renderDataTable("custTable", {
    searchPlaceholder: "Search customer…",
    columns: [
      { key: "customerName", label: "Customer" },
      { key: "saeList", label: "SAE", render: r => r.saeList.join(", ") },
      { key: "billCount", label: "Bills", numeric: true },
      { key: "totalBilled", label: "Total Billed", numeric: true, render: r => fmtRupee(r.totalBilled) },
      { key: "totalPaid", label: "Total Paid", numeric: true, render: r => fmtRupee(r.totalPaid) },
      { key: "totalReturned", label: "Returned", numeric: true, render: r => fmtRupee(r.totalReturned) },
      { key: "outstandingExcludingSurplus", label: "Outstanding (Excl. Surplus)", numeric: true, render: r => `<strong>${fmtRupee(r.outstandingExcludingSurplus)}</strong>` },
      { key: "surplus", label: "Surplus/Advance", numeric: true, render: r => r.surplus > 0.5 ? fmtRupee(r.surplus) : "—" },
      { key: "outstandingIncludingSurplus", label: "Outstanding (Incl. Surplus)", numeric: true, render: r => fmtRupee(r.outstandingIncludingSurplus) },
      { key: "pendingBillCount", label: "Pending Bills", numeric: true },
      { key: "oldestPendingAge", label: "Oldest Age (days)", numeric: true, render: r => r.oldestPendingAge ?? "—" }
    ],
    rows,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey)
  });
}

/* ================= BILL-WISE LEDGER ================= */
function renderLedger(DB, f) {
  const bills = filterBills(DB.bills, f).sort((a, b) => (b.billDate || 0) - (a.billDate || 0));

  const orderValue = bills.reduce((s, b) => s + b.billValue, 0);
  const amountReceived = bills.reduce((s, b) => s + b.paidAmount, 0);
  const stockReturnAmt = bills.reduce((s, b) => s + b.returnedAmount, 0);
  const outstanding = bills.reduce((s, b) => s + b.pendingBalance, 0);
  const pendingOrders = bills.filter(b => b.pendingBalance > 0.5).length;

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Order Value", fmtRupee(orderValue), bills.length + " orders")}
      ${kpiCard("Amount Received", fmtRupee(amountReceived), "", "sage")}
      ${kpiCard("Stock Return", fmtRupee(stockReturnAmt), "", "amber")}
      ${kpiCard("Outstanding", fmtRupee(outstanding), pendingOrders + " orders pending", "clay")}
      ${kpiCard("No. of Orders", bills.length, "")}
      ${kpiCard("Pending Orders", pendingOrders, "")}
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Bill-wise Ledger (${bills.length})</div>
        <div class="panel-note">Every order = one bill. Pending balance = bill value − allocated payments − allocated returns (oldest-bill-first).</div>
      </div>
      <div id="ledgerTable"></div>
    </div>
  `;

  renderDataTable("ledgerTable", {
    searchPlaceholder: "Search customer or order ID…",
    pageSize: 15,
    columns: [
      { key: "orderId", label: "Order ID" },
      { key: "customerName", label: "Customer" },
      { key: "sae", label: "SAE" },
      { key: "deliveryDate", label: "Delivery Date", render: r => formatDate(r.deliveryDate) },
      { key: "billValue", label: "Bill Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "paidAmount", label: "Paid", numeric: true, render: r => fmtRupee(r.paidAmount) },
      { key: "returnedAmount", label: "Returned", numeric: true, render: r => fmtRupee(r.returnedAmount) },
      { key: "pendingBalance", label: "Pending", numeric: true, render: r => `<strong>${fmtRupee(r.pendingBalance)}</strong>` },
      { key: "ageDays", label: "Age (days)", numeric: true, render: r => r.ageDays ?? "—" },
      { key: "status", label: "Status", render: r => statusTag(r.status) }
    ],
    rows: bills,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey, row.orderId)
  });
}

/* ================= PRODUCT ANALYSIS ================= */
const productPageState = { dims: new Set(), designs: new Set(), majorColors: new Set(), minorColors: new Set(), includeInProgress: false };
const productPriceFilterState = {
  dimensions: new Set(), subTypes: new Set(), productNames: new Set(),
  designs: new Set(), majorColors: new Set(), minorColors: new Set()
};

function multiSelectHtml(id, options, selectedSet) {
  return `<select id="${id}" multiple size="1">${options.map(o => `<option value="${o}" ${selectedSet.has(o) ? "selected" : ""}>${o}</option>`).join("")}</select>`;
}

function renderProducts(DB, f) {
  const lines = filterOrderLines(DB.orderLines, f);
  const filteredOrderIds = new Set(filterBills(DB.bills, f).map(b => b.orderId));
  let inScope = lines.filter(l => filteredOrderIds.has(l.orderUid) && (productPageState.includeInProgress || l.isDelivered));

  if (productPageState.dims.size) inScope = inScope.filter(l => productPageState.dims.has(l.dimensions));
  if (productPageState.designs.size) inScope = inScope.filter(l => productPageState.designs.has(l.designs));
  if (productPageState.majorColors.size) inScope = inScope.filter(l => productPageState.majorColors.has(l.majorColor));
  if (productPageState.minorColors.size) inScope = inScope.filter(l => productPageState.minorColors.has(l.minorColor));

  const map = {};
  inScope.forEach(l => {
    const k = l.productName;
    const p = (map[k] = map[k] || { productName: k, qty: 0, amount: 0, orders: new Set(), returned: 0, returnedAmt: 0 });
    p.qty += l.finalQty; p.amount += l.amount; p.orders.add(l.orderUid);
  });
  filterReturns(DB.stockReturns, f).forEach(r => {
    const k = r.productName;
    const p = (map[k] = map[k] || { productName: k, qty: 0, amount: 0, orders: new Set(), returned: 0, returnedAmt: 0 });
    p.returned += r.qty; p.returnedAmt += r.amount;
  });
  const rows = Object.values(map).map(p => ({
    ...p, orderCount: p.orders.size,
    returnRatePct: p.qty > 0 ? +((p.returned / p.qty) * 100).toFixed(1) : 0
  })).sort((a, b) => b.amount - a.amount);

  const topByQty = rows.slice().sort((a, b) => b.qty - a.qty).slice(0, 10);
  const topByValue = rows.slice(0, 10);

  document.getElementById("viewRoot").innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Product Filters</div>
        <div class="panel-note">${productPageState.includeInProgress ? "Delivered + in-progress orders" : "Delivered orders only (sold)"}</div>
      </div>
      <div class="inline-filterbar">
        <div class="filter-group"><label>Dimensions</label>${multiSelectHtml("pf_dims", DB.dimensionList, productPageState.dims)}</div>
        <div class="filter-group"><label>Designs</label>${multiSelectHtml("pf_designs", DB.designList, productPageState.designs)}</div>
        <div class="filter-group"><label>Major Color</label>${multiSelectHtml("pf_major", DB.majorColorList, productPageState.majorColors)}</div>
        <div class="filter-group"><label>Minor Color</label>${multiSelectHtml("pf_minor", DB.minorColorList, productPageState.minorColors)}</div>
        <div class="filter-group">
          <label>&nbsp;</label>
          <label style="font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:6px;color:var(--ink)">
            <input type="checkbox" id="pf_includeProgress" ${productPageState.includeInProgress ? "checked" : ""}> Include in-progress orders
          </label>
        </div>
        <div class="filter-group filter-actions"><button id="pf_clear" class="btn btn-ghost btn-sm">Clear</button></div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Product-wise Sold Qty</div><div class="panel-note">Irrespective of dimensions / colors / designs unless filtered above</div></div>
        <div class="chart-wrap"><canvas id="chartProdQty"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Top Products by Sales Value</div></div>
        <div class="chart-wrap"><canvas id="chartProdVal"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Product Detail (${rows.length})</div><div class="panel-note">Click a row to see its dimension / color variants</div></div>
      <div id="productTable"></div>
    </div>
  `;

  makeBarChart("chartProdQty", topByQty.map(p => p.productName.slice(0, 20)), [{ label: "Qty", data: topByQty.map(p => p.qty), backgroundColor: CHART_PALETTE[0] }], { horizontal: true });
  makeBarChart("chartProdVal", topByValue.map(p => p.productName.slice(0, 20)), [{ label: "Value", data: topByValue.map(p => p.amount), backgroundColor: CHART_PALETTE[1] }], { horizontal: true });

  renderDataTable("productTable", {
    searchPlaceholder: "Search product…",
    columns: [
      { key: "productName", label: "Product" },
      { key: "orderCount", label: "Orders", numeric: true },
      { key: "qty", label: "Qty Sold", numeric: true },
      { key: "amount", label: "Value Sold", numeric: true, render: r => fmtRupee(r.amount) },
      { key: "returned", label: "Qty Returned", numeric: true },
      { key: "returnRatePct", label: "Return Rate", numeric: true, render: r => r.returnRatePct + "%" }
    ],
    rows,
    onRowClick: (row) => openProductVariants(DB, row.productName, f)
  });

  const bindMulti = (id, targetSet) => {
    document.getElementById(id).addEventListener("change", (e) => {
      targetSet.clear();
      Array.from(e.target.selectedOptions).forEach(o => targetSet.add(o.value));
      renderProducts(DB, f);
    });
  };
  bindMulti("pf_dims", productPageState.dims);
  bindMulti("pf_designs", productPageState.designs);
  bindMulti("pf_major", productPageState.majorColors);
  bindMulti("pf_minor", productPageState.minorColors);
  document.getElementById("pf_includeProgress").addEventListener("change", (e) => {
    productPageState.includeInProgress = e.target.checked; renderProducts(DB, f);
  });
  document.getElementById("pf_clear").addEventListener("click", () => {
    productPageState.dims.clear(); productPageState.designs.clear();
    productPageState.majorColors.clear(); productPageState.minorColors.clear();
    productPageState.includeInProgress = false;
    renderProducts(DB, f);
  });
}

/* ================= PAYMENTS ANALYSIS ================= */
function renderPayments(DB, f) {
  const payments = filterPayments(DB.payments, f).sort((a, b) => b.date - a.date);
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);

  const monthly = {};
  payments.forEach(p => { const k = monthKey(p.date); monthly[k] = (monthly[k] || 0) + p.amount; });
  const months = Object.keys(monthly).sort();

  const byVia = groupSum(payments, p => p.via, p => p.amount);
  const bySae = groupSum(payments, p => p.sae, p => p.amount);

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Total Collected", fmtRupee(totalCollected), payments.length + " payments", "sage")}
      ${kpiCard("Avg. Payment", fmtRupee(payments.length ? totalCollected / payments.length : 0), "")}
      ${kpiCard("Distinct Customers Paid", new Set(payments.map(p => p.customerKey)).size, "")}
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Collections Over Time</div></div>
        <div class="chart-wrap"><canvas id="chartPayTrend"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Collections by Mode</div></div>
        <div class="chart-wrap"><canvas id="chartPayVia"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Collections by SAE</div></div>
      <div class="chart-wrap"><canvas id="chartPaySae"></canvas></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Payment Log (${payments.length})</div></div>
      <div id="paymentsTable"></div>
    </div>
  `;

  makeLineChart("chartPayTrend", months.map(monthLabel), [{ label: "Collected", data: months.map(m => monthly[m]) }]);
  const viaEntries = Object.entries(byVia);
  makeDoughnut("chartPayVia", viaEntries.map(e => e[0]), viaEntries.map(e => e[1]));
  const saeEntries = topN(bySae, 10);
  makeBarChart("chartPaySae", saeEntries.map(e => e[0]), [{ label: "Collected", data: saeEntries.map(e => e[1]) }]);

  renderDataTable("paymentsTable", {
    searchPlaceholder: "Search customer…",
    pageSize: 15,
    columns: [
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "customerName", label: "Customer" },
      { key: "sae", label: "SAE" },
      { key: "via", label: "Mode" },
      { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
    ],
    rows: payments,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey)
  });
}

/* ================= STOCK RETURNS ================= */
function renderReturns(DB, f) {
  const returns = filterReturns(DB.stockReturns, f).sort((a, b) => b.date - a.date);
  const totalReturned = returns.reduce((s, r) => s + r.amount, 0);

  const byProduct = topN(groupSum(returns, r => r.productName, r => r.amount), 10);
  const byCustomer = topN(groupSum(returns, r => r.customerName, r => r.amount), 10);

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Total Returned Value", fmtRupee(totalReturned), returns.length + " entries", "amber")}
      ${kpiCard("Distinct Products Returned", new Set(returns.map(r => r.productName)).size, "")}
      ${kpiCard("Distinct Customers", new Set(returns.map(r => r.customerKey)).size, "")}
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Returns by Product</div></div>
        <div class="chart-wrap"><canvas id="chartRetProd"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Returns by Customer</div></div>
        <div class="chart-wrap"><canvas id="chartRetCust"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Return Log (${returns.length})</div></div>
      <div id="returnsTable"></div>
    </div>
  `;

  makeBarChart("chartRetProd", byProduct.map(e => e[0].slice(0, 20)), [{ label: "Value", data: byProduct.map(e => e[1]), backgroundColor: CHART_PALETTE[2] }], { horizontal: true });
  makeBarChart("chartRetCust", byCustomer.map(e => e[0].slice(0, 20)), [{ label: "Value", data: byCustomer.map(e => e[1]), backgroundColor: CHART_PALETTE[3] }], { horizontal: true });

  renderDataTable("returnsTable", {
    searchPlaceholder: "Search customer or product…",
    pageSize: 15,
    columns: [
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "customerName", label: "Customer" },
      { key: "sae", label: "SAE" },
      { key: "productName", label: "Product" },
      { key: "qty", label: "Qty", numeric: true },
      { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
    ],
    rows: returns,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey)
  });
}

/* ================= CREDIT VS PAID SALES ================= */
function renderCreditPaid(DB, f) {
  const bills = filterBills(DB.bills, f);
  const filteredOrderIds = new Set(bills.map(b => b.orderId));
  const lines = filterOrderLines(DB.orderLines, f).filter(l => filteredOrderIds.has(l.orderUid));

  const creditBills = bills.filter(b => b.saleType === "Credit Sale");
  const paidBills = bills.filter(b => b.saleType === "Paid Sale");
  const creditValue = creditBills.reduce((s, b) => s + b.billValue, 0);
  const paidValue = paidBills.reduce((s, b) => s + b.billValue, 0);
  const totalValue = creditValue + paidValue;

  const monthly = {};
  bills.forEach(b => {
    const k = monthKey(b.deliveryDate || b.billDate);
    const m = (monthly[k] = monthly[k] || { credit: 0, paid: 0 });
    if (b.saleType === "Credit Sale") m.credit += b.billValue; else m.paid += b.billValue;
  });
  const months = Object.keys(monthly).sort();

  const custMap = {};
  bills.forEach(b => {
    const c = (custMap[b.customerKey] = custMap[b.customerKey] || { customerName: b.customerName, customerKey: b.customerKey, creditValue: 0, paidValue: 0, creditCount: 0, paidCount: 0 });
    if (b.saleType === "Credit Sale") { c.creditValue += b.billValue; c.creditCount += 1; }
    else { c.paidValue += b.billValue; c.paidCount += 1; }
  });
  const custRows = Object.values(custMap).sort((a, b) => (b.creditValue) - (a.creditValue));

  // Product-wise average price, credit vs paid, month by month
  let priceLines = lines;
  if (productPriceFilterState.dimensions.size) priceLines = priceLines.filter(l => productPriceFilterState.dimensions.has(l.dimensions));
  if (productPriceFilterState.subTypes.size) priceLines = priceLines.filter(l => productPriceFilterState.subTypes.has(l.subType));
  if (productPriceFilterState.productNames.size) priceLines = priceLines.filter(l => productPriceFilterState.productNames.has(l.productName));
  if (productPriceFilterState.designs.size) priceLines = priceLines.filter(l => productPriceFilterState.designs.has(l.designs));
  if (productPriceFilterState.majorColors.size) priceLines = priceLines.filter(l => productPriceFilterState.majorColors.has(l.majorColor));
  if (productPriceFilterState.minorColors.size) priceLines = priceLines.filter(l => productPriceFilterState.minorColors.has(l.minorColor));

  const prodMonthMap = {};
  priceLines.forEach(l => {
    const k = l.productName + "||" + monthKey(l.date);
    const p = (prodMonthMap[k] = prodMonthMap[k] || { productName: l.productName, month: monthKey(l.date), creditQty: 0, creditAmt: 0, paidQty: 0, paidAmt: 0 });
    const qty = l.finalQty;
    if (l.saleType === "Credit Sale") { p.creditQty += qty; p.creditAmt += l.amount; }
    else { p.paidQty += qty; p.paidAmt += l.amount; }
  });
  const prodMonthRows = Object.values(prodMonthMap).map(p => ({
    ...p,
    creditAvgPrice: p.creditQty > 0 ? +(p.creditAmt / p.creditQty).toFixed(2) : null,
    paidAvgPrice: p.paidQty > 0 ? +(p.paidAmt / p.paidQty).toFixed(2) : null
  })).sort((a, b) => (b.month || "").localeCompare(a.month || ""));

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Credit Sales Value", fmtRupee(creditValue), creditBills.length + " bills — unpaid at time of order", "clay")}
      ${kpiCard("Paid Sales Value", fmtRupee(paidValue), paidBills.length + " bills — settled same day", "sage")}
      ${kpiCard("Credit Share", totalValue ? ((creditValue / totalValue) * 100).toFixed(1) + "%" : "—", "of total billed value")}
    </div>
    <p class="small-note" style="margin-top:-10px;margin-bottom:16px">
      Classification is decided once, at the time the bill was raised, and never changes: if payments dated the <em>same day</em>
      as the bill fully covered its value, it's a Paid Sale; otherwise it's a Credit Sale — even if it's fully paid off later.
      This is inferred from payment dates since the sheet doesn't have an explicit credit/cash flag.
    </p>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Credit vs Paid — Monthly Trend</div></div>
        <div class="chart-wrap"><canvas id="chartCreditTrend"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Credit vs Paid — Split</div></div>
        <div class="chart-wrap"><canvas id="chartCreditSplit"></canvas></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Order-wise (${bills.length})</div></div>
      <div id="creditOrderTable"></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Customer-wise Credit vs Paid</div></div>
      <div id="creditCustTable"></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Product-wise Average Price — Credit vs Paid (by month)</div><div class="panel-note">Use the slicers to compare dimensions, subtype, product, design, and colors; click a row for detail.</div></div>
      <div class="inline-filterbar product-price-filters">
        <div class="filter-group"><label>Dimension</label>${multiSelectHtml("cpf_dims", DB.dimensionList, productPriceFilterState.dimensions)}</div>
        <div class="filter-group"><label>Subtype</label>${multiSelectHtml("cpf_subtypes", DB.subTypeList, productPriceFilterState.subTypes)}</div>
        <div class="filter-group"><label>Product Name</label>${multiSelectHtml("cpf_products", DB.productNameList, productPriceFilterState.productNames)}</div>
        <div class="filter-group"><label>Design</label>${multiSelectHtml("cpf_designs", DB.designList, productPriceFilterState.designs)}</div>
        <div class="filter-group"><label>Major Color</label>${multiSelectHtml("cpf_major", DB.majorColorList, productPriceFilterState.majorColors)}</div>
        <div class="filter-group"><label>Minor Color</label>${multiSelectHtml("cpf_minor", DB.minorColorList, productPriceFilterState.minorColors)}</div>
        <div class="filter-group filter-actions"><button id="cpf_clear" class="btn btn-ghost btn-sm">Clear</button></div>
      </div>
      <div id="creditProductTable"></div>
    </div>
  `;

  makeLineChart("chartCreditTrend", months.map(monthLabel), [
    { label: "Credit Sales", data: months.map(m => monthly[m].credit) },
    { label: "Paid Sales", data: months.map(m => monthly[m].paid) }
  ]);
  makeDoughnut("chartCreditSplit", ["Credit Sales", "Paid Sales"], [creditValue, paidValue]);

  renderDataTable("creditOrderTable", {
    searchPlaceholder: "Search customer or order ID…", pageSize: 12,
    columns: [
      { key: "orderId", label: "Order ID" },
      { key: "customerName", label: "Customer" },
      { key: "sae", label: "SAE" },
      { key: "deliveryDate", label: "Delivery Date", render: r => formatDate(r.deliveryDate) },
      { key: "billValue", label: "Bill Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "saleType", label: "Type", render: r => `<span class="tag ${r.saleType === "Credit Sale" ? "tag-pending" : "tag-paid"}">${r.saleType}</span>` },
      { key: "status", label: "Current Status", render: r => statusTag(r.status) }
    ],
    rows: bills,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey, row.orderId)
  });

  renderDataTable("creditCustTable", {
    searchPlaceholder: "Search customer…", pageSize: 12,
    columns: [
      { key: "customerName", label: "Customer" },
      { key: "creditCount", label: "Credit Bills", numeric: true },
      { key: "creditValue", label: "Credit Value", numeric: true, render: r => fmtRupee(r.creditValue) },
      { key: "paidCount", label: "Paid Bills", numeric: true },
      { key: "paidValue", label: "Paid Value", numeric: true, render: r => fmtRupee(r.paidValue) }
    ],
    rows: custRows,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey)
  });

  renderDataTable("creditProductTable", {
    searchPlaceholder: "Search product…", pageSize: 12,
    columns: [
      { key: "month", label: "Month", render: r => monthLabel(r.month) },
      { key: "productName", label: "Product" },
      { key: "creditQty", label: "Credit Qty", numeric: true },
      { key: "creditAvgPrice", label: "Credit Avg Price", numeric: true, render: r => r.creditAvgPrice !== null ? fmtRupee(r.creditAvgPrice) : "—" },
      { key: "paidQty", label: "Paid Qty", numeric: true },
      { key: "paidAvgPrice", label: "Paid Avg Price", numeric: true, render: r => r.paidAvgPrice !== null ? fmtRupee(r.paidAvgPrice) : "—" }
    ],
    rows: prodMonthRows,
    onRowClick: (row) => openProductPriceDrilldown(DB, row, priceLines)
  });

  const bindPriceMulti = (id, targetSet) => {
    document.getElementById(id).addEventListener("change", (e) => {
      targetSet.clear();
      Array.from(e.target.selectedOptions).forEach(o => targetSet.add(o.value));
      renderCreditPaid(DB, f);
    });
  };
  bindPriceMulti("cpf_dims", productPriceFilterState.dimensions);
  bindPriceMulti("cpf_subtypes", productPriceFilterState.subTypes);
  bindPriceMulti("cpf_products", productPriceFilterState.productNames);
  bindPriceMulti("cpf_designs", productPriceFilterState.designs);
  bindPriceMulti("cpf_major", productPriceFilterState.majorColors);
  bindPriceMulti("cpf_minor", productPriceFilterState.minorColors);
  document.getElementById("cpf_clear").addEventListener("click", () => {
    Object.values(productPriceFilterState).forEach(set => set.clear());
    renderCreditPaid(DB, f);
  });
}

/* ================= RAW DATA ================= */
function renderRaw(DB, f) {
  document.getElementById("viewRoot").innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Orders (${filterBills(DB.bills, f).length})</div></div>
      <div id="rawOrders"></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Order Lines (${filterOrderLines(DB.orderLines, f).length})</div></div>
      <div id="rawLines"></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Payments (${filterPayments(DB.payments, f).length})</div></div>
      <div id="rawPayments"></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Stock Returns (${filterReturns(DB.stockReturns, f).length})</div></div>
      <div id="rawReturns"></div>
    </div>
  `;
  renderDataTable("rawOrders", { columns: [
    { key: "orderId", label: "Order ID" }, { key: "customerName", label: "Customer" }, { key: "sae", label: "SAE" },
    { key: "deliveryDate", label: "Delivery Date", render: r => formatDate(r.deliveryDate) }, { key: "billValue", label: "Value", numeric: true, render: r => fmtRupee(r.billValue) },
    { key: "deliveryMode", label: "Delivery Mode" }
  ], rows: filterBills(DB.bills, f) });

  renderDataTable("rawLines", { columns: [
    { key: "orderUid", label: "Order ID" }, { key: "customerName", label: "Customer" }, { key: "productName", label: "Product" },
    { key: "dimensions", label: "Dimensions" }, { key: "majorColor", label: "Color" },
    { key: "qty", label: "Qty", numeric: true }, { key: "finalQty", label: "Final Qty", numeric: true },
    { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
  ], rows: filterOrderLines(DB.orderLines, f) });

  renderDataTable("rawPayments", { columns: [
    { key: "date", label: "Date", render: r => formatDate(r.date) }, { key: "customerName", label: "Customer" },
    { key: "sae", label: "SAE" }, { key: "via", label: "Mode" }, { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
  ], rows: filterPayments(DB.payments, f) });

  renderDataTable("rawReturns", { columns: [
    { key: "date", label: "Date", render: r => formatDate(r.date) }, { key: "customerName", label: "Customer" },
    { key: "productName", label: "Product" }, { key: "qty", label: "Qty", numeric: true },
    { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
  ], rows: filterReturns(DB.stockReturns, f) });
}

/* ================= DRILL-DOWN MODALS ================= */
function openModal(html) {
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modal").hidden = false;
}
function closeModal() { document.getElementById("modal").hidden = true; }

function openCustomerLedger(DB, customerKey, highlightOrderId) {
  const bills = DB.bills.filter(b => b.customerKey === customerKey).sort((a, b) => a.billDate - b.billDate);
  if (!bills.length) return;
  const cust = bills[0];
  const totalBilled = bills.reduce((s, b) => s + b.billValue, 0);
  const totalPaid = bills.reduce((s, b) => s + b.paidAmount, 0);
  const totalReturned = bills.reduce((s, b) => s + b.returnedAmount, 0);
  const totalPending = bills.reduce((s, b) => s + b.pendingBalance, 0);
  const payments = DB.payments.filter(p => p.customerKey === customerKey).sort((a, b) => b.date - a.date);

  openModal(`
    <h2 style="margin:0 0 4px;color:var(--navy)">${cust.customerName}</h2>
    <p class="small-note" style="margin-bottom:16px">SAE(s) across history: ${Array.from(new Set(bills.map(b => b.sae))).join(", ")}</p>
    <div class="kpi-grid" style="margin-bottom:18px">
      ${kpiCard("Total Billed", fmtRupee(totalBilled))}
      ${kpiCard("Total Paid", fmtRupee(totalPaid), "", "sage")}
      ${kpiCard("Returned", fmtRupee(totalReturned), "", "amber")}
      ${kpiCard("Outstanding", fmtRupee(totalPending), "", "clay")}
    </div>
    <div class="panel-title" style="margin-bottom:8px">Bill-wise ledger</div>
    <div id="modalLedgerTable" style="margin-bottom:20px"></div>
    <div class="panel-title" style="margin-bottom:8px">Payment history</div>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Date</th><th>SAE</th><th>Mode</th><th>Amount</th></tr></thead>
        <tbody>${payments.map(p => `<tr><td>${formatDate(p.date)}</td><td>${p.sae}</td><td>${p.via}</td><td class="num">${fmtRupee(p.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-note">No payments recorded.</td></tr>`}</tbody>
      </table>
    </div>
  `);

  renderDataTable("modalLedgerTable", {
    searchPlaceholder: false, pageSize: 8,
    columns: [
      { key: "orderId", label: "Order ID" },
      { key: "billDate", label: "Date", render: r => formatDate(r.billDate) },
      { key: "billValue", label: "Bill Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "paidAmount", label: "Paid", numeric: true, render: r => fmtRupee(r.paidAmount) },
      { key: "returnedAmount", label: "Returned", numeric: true, render: r => fmtRupee(r.returnedAmount) },
      { key: "pendingBalance", label: "Pending", numeric: true, render: r => `<strong>${fmtRupee(r.pendingBalance)}</strong>` },
      { key: "ageDays", label: "Age", numeric: true, render: r => r.ageDays ?? "—" },
      { key: "status", label: "Status", render: r => statusTag(r.status) }
    ],
    rows: bills
  });
}

function openProductVariants(DB, productName, f) {
  const filteredOrderIds = new Set(filterBills(DB.bills, f).map(b => b.orderId));
  const lines = DB.orderLines.filter(l => l.productName === productName && filteredOrderIds.has(l.orderUid));
  const variantMap = {};
  lines.forEach(l => {
    const key = [l.dimensions || "—", l.majorColor || "—", l.minorColor || "—", l.designs || "—"].join(" / ");
    const v = (variantMap[key] = variantMap[key] || { key, qty: 0, amount: 0 });
    v.qty += l.finalQty; v.amount += l.amount;
  });
  const rows = Object.values(variantMap).sort((a, b) => b.amount - a.amount);

  openModal(`
    <h2 style="margin:0 0 4px;color:var(--navy)">${productName}</h2>
    <p class="small-note" style="margin-bottom:16px">Breakdown by Dimensions / Major Color / Minor Color / Design</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Variant (Dim / Color / Color2 / Design)</th><th>Qty</th><th>Value</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.key}</td><td class="num">${r.qty}</td><td class="num">${fmtRupee(r.amount)}</td></tr>`).join("") || `<tr><td colspan="3" class="empty-note">No variant detail available.</td></tr>`}</tbody>
      </table>
    </div>
  `);
}

document.getElementById("modalClose")?.addEventListener("click", closeModal);
document.getElementById("modalBackdrop")?.addEventListener("click", closeModal);


function openProductPriceDrilldown(DB, row, lines) {
  const detailLines = lines.filter(l => l.productName === row.productName && monthKey(l.date) === row.month);
  const variantMap = {};
  detailLines.forEach(l => {
    const key = [l.dimensions || "—", l.subType || "—", l.designs || "—", l.majorColor || "—", l.minorColor || "—"].join("||");
    const v = (variantMap[key] = variantMap[key] || {
      dimensions: l.dimensions || "—", subType: l.subType || "—", designs: l.designs || "—",
      majorColor: l.majorColor || "—", minorColor: l.minorColor || "—",
      creditQty: 0, creditAmt: 0, paidQty: 0, paidAmt: 0
    });
    if (l.saleType === "Credit Sale") { v.creditQty += l.finalQty; v.creditAmt += l.amount; }
    else { v.paidQty += l.finalQty; v.paidAmt += l.amount; }
  });
  const rows = Object.values(variantMap).map(v => ({
    ...v,
    creditAvgPrice: v.creditQty > 0 ? v.creditAmt / v.creditQty : null,
    paidAvgPrice: v.paidQty > 0 ? v.paidAmt / v.paidQty : null
  })).sort((a, b) => ((b.creditAmt + b.paidAmt) - (a.creditAmt + a.paidAmt)));
  const n = value => value === null ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  openModal(`
    <h2 style="margin:0 0 4px;color:var(--navy)">${row.productName}</h2>
    <p class="small-note" style="margin-bottom:16px">${monthLabel(row.month)} · Credit vs Paid variant drill-down</p>
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Dimension</th><th>Subtype</th><th>Design</th><th>Major Color</th><th>Minor Color</th><th>Credit Qty</th><th>Credit Avg Price</th><th>Paid Qty</th><th>Paid Avg Price</th></tr></thead>
        <tbody>${rows.map(v => `<tr><td>${v.dimensions}</td><td>${v.subType}</td><td>${v.designs}</td><td>${v.majorColor}</td><td>${v.minorColor}</td><td class="num">${n(v.creditQty)}</td><td class="num">${v.creditAvgPrice === null ? "—" : fmtRupee(v.creditAvgPrice)}</td><td class="num">${n(v.paidQty)}</td><td class="num">${v.paidAvgPrice === null ? "—" : fmtRupee(v.paidAvgPrice)}</td></tr>`).join("") || `<tr><td colspan="9" class="empty-note">No variant detail available.</td></tr>`}</tbody>
      </table>
    </div>
  `);
}
