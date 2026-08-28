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
function calendarDayKey(date) {
  if (!date) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function activeDayCount(items, dateFn) {
  return new Set(items.map(dateFn).map(calendarDayKey).filter(Boolean)).size;
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
  const customerRowsAll = summarizeBillsByCustomer(bills, payments, returns);
  const totalOutstanding = customerRowsAll.reduce((s, c) => s + c.outstandingExcludingSurplus, 0);
  const totalOutstandingIncludingSurplus = customerRowsAll.reduce((s, c) => s + c.outstandingIncludingSurplus, 0);
  const totalSurplus = customerRowsAll.reduce((s, c) => s + c.surplus, 0);
  const totalReturned = returns.reduce((s, r) => s + r.amount, 0);
  const collectionPct = totalBilled > 0 ? ((totalCollected + totalReturned) / totalBilled * 100) : 0;
  const activeCustomers = new Set(bills.map(b => b.customerKey)).size;
  const avgOrderValue = deliveredBills.length ? totalBilled / deliveredBills.length : 0;
  const salesDays = activeDayCount(deliveredBills, b => b.deliveryDate || b.billDate);
  const paymentDays = activeDayCount(payments, p => p.date);
  const avgSalesPerDay = salesDays ? totalBilled / salesDays : 0;
  const avgPaymentPerDay = paymentDays ? totalCollected / paymentDays : 0;

  const saeSalesMap = {};
  deliveredBills.forEach(b => { saeSalesMap[b.sae] = (saeSalesMap[b.sae] || 0) + b.billValue; });
  const saeSales = topN(saeSalesMap, 10).map(([sae, salesValue]) => ({ sae, salesValue }));

  const monthly = {};
  deliveredBills.forEach(b => { const k = monthKey(b.deliveryDate || b.billDate); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).sale += b.billValue; });
  payments.forEach(p => { const k = monthKey(p.date); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).pay += p.amount; });
  returns.forEach(r => { const k = monthKey(r.date); (monthly[k] = monthly[k] || { sale: 0, pay: 0, ret: 0 }).ret += r.amount; });
  const months = Object.keys(monthly).sort();

  const custRows = customerRowsAll.slice().sort((a, b) => b.outstandingExcludingSurplus - a.outstandingExcludingSurplus).slice(0, 10);
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
      ${kpiCard("Outstanding (Incl. Surplus)", fmtRupee(totalOutstandingIncludingSurplus), "Order Value − Payment − Return")}
      ${kpiCard("Stock Returns", fmtRupee(totalReturned), returns.length + " return entries", "amber")}
      ${kpiCard("Collection %", collectionPct.toFixed(1) + "%", "paid + returned ÷ billed")}
      ${kpiCard("Avg. Bill Value", fmtRupee(avgOrderValue), "")}
      ${kpiCard("Average Sales / Day", fmtRupee(avgSalesPerDay), `${salesDays} active delivery days`, "sage")}
      ${kpiCard("Avg. Payment Received / Day", fmtRupee(avgPaymentPerDay), `${paymentDays} active payment days`, "sage")}
    </div>
    <p class="small-note" style="margin-top:-10px;margin-bottom:16px">Sales Value and Order Value use the Order sheet's Delivery Date and include delivered orders only. In Progress cards remain independent of the global date range.</p>
    <div class="summary-export-row"><button type="button" id="summaryExportBtn" class="btn btn-outline btn-sm">Download Excel</button></div>

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

  document.getElementById("summaryExportBtn").addEventListener("click", () => downloadExcelFile("executive_summary", [
    { key: "metric", label: "Metric" }, { key: "value", label: "Value" }, { key: "detail", label: "Detail" }
  ], [
    { metric: "Sales Value (Delivered)", value: salesValue, detail: "Order Value · selected Delivery Date" },
    { metric: "Delivered Orders", value: deliveredBills.length, detail: "within selected Delivery Date" },
    { metric: "In Progress Value", value: inProgressValue, detail: "all delivery dates" },
    { metric: "In Progress Orders", value: inProgressBills.length, detail: "all delivery dates" },
    { metric: "Total Collected", value: totalCollected, detail: `${payments.length} payments` },
    { metric: "Outstanding (Excl. Surplus)", value: totalOutstanding, detail: "positive customer net balances" },
    { metric: "Outstanding (Incl. Surplus)", value: totalOutstandingIncludingSurplus, detail: "Order Value − Payment − Return" },
    { metric: "Stock Returns", value: totalReturned, detail: `${returns.length} return entries` },
    { metric: "Collection %", value: +collectionPct.toFixed(1), detail: "paid + returned ÷ billed" },
    { metric: "Avg. Bill Value", value: avgOrderValue, detail: "delivered orders" },
    { metric: "Average Sales / Day", value: avgSalesPerDay, detail: `${salesDays} active delivery days` },
    { metric: "Avg. Payment Received / Day", value: avgPaymentPerDay, detail: `${paymentDays} active payment days` }
  ]));

  makeLineChart("chartTrend", months.map(monthLabel), [
    { label: "Sales", data: months.map(m => monthly[m].sale) },
    { label: "Payments", data: months.map(m => monthly[m].pay) },
    { label: "Returns", data: months.map(m => monthly[m].ret) }
  ]);

  makeBarChart("chartTopCust", custRows.map(c => c.customerName.slice(0, 22)), [
    { label: "Outstanding", data: custRows.map(c => c.outstandingExcludingSurplus) }
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
  const payments = filterPayments(DB.payments, f);
  const returns = filterReturns(DB.stockReturns, f);
  const custRows = summarizeBillsByCustomer(bills, payments, returns).sort((a, b) => b.outstandingExcludingSurplus - a.outstandingExcludingSurplus);
  const receiptOnlyCustomers = custRows.filter(c => c.billCount === 0 && (c.totalPaid > 0 || c.totalReturned > 0));

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
        <div class="panel-note">Order Value − Payment − Return; negative customer totals are shown as surplus/advance. ${receiptOnlyCustomers.length ? `${receiptOnlyCustomers.length} payment/return-only customer${receiptOnlyCustomers.length === 1 ? "" : "s"} included.` : ""}</div>
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
      { key: "activityType", label: "Activity", render: r => r.billCount ? "Orders + receipts" : "Payment/return only" },
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
  dimensions: "", subTypes: "", productNames: "", designs: "", majorColors: "", minorColors: ""
};
const productPricePivotState = { expanded: new Set(), search: "" };
const PRODUCT_PRICE_FILTERS = [
  ["dimensions", "dimensions", "cpf_dims"], ["subTypes", "subType", "cpf_subtypes"],
  ["productNames", "productName", "cpf_products"], ["designs", "designs", "cpf_designs"],
  ["majorColors", "majorColor", "cpf_major"], ["minorColors", "minorColor", "cpf_minor"]
];

function dependentSelectHtml(id, options, selected) {
  return `<select id="${id}"><option value="">All</option>${options.map(o => `<option value="${o}" ${selected === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
}

function productPriceMatches(line, skipKey) {
  return PRODUCT_PRICE_FILTERS.every(([stateKey, field]) => {
    if (stateKey === skipKey) return true;
    return !productPriceFilterState[stateKey] || line[field] === productPriceFilterState[stateKey];
  });
}

function prepareProductPriceFilters(lines) {
  // A selector's options are derived from the current selection of every other selector.
  // Invalid downstream selections are cleared so the dropdowns never become contradictory.
  let changed = true;
  while (changed) {
    changed = false;
    PRODUCT_PRICE_FILTERS.forEach(([stateKey, field]) => {
      const available = new Set(lines.filter(l => productPriceMatches(l, stateKey)).map(l => l[field]).filter(Boolean));
      if (productPriceFilterState[stateKey] && !available.has(productPriceFilterState[stateKey])) {
        productPriceFilterState[stateKey] = "";
        changed = true;
      }
    });
  }
  const options = {};
  PRODUCT_PRICE_FILTERS.forEach(([stateKey, field]) => {
    options[stateKey] = Array.from(new Set(lines.filter(l => productPriceMatches(l, stateKey)).map(l => l[field]).filter(Boolean))).sort();
  });
  return { lines: lines.filter(l => productPriceMatches(l, null)), options };
}

function pivotMetrics() { return { creditQty: 0, creditAmt: 0, paidQty: 0, paidAmt: 0 }; }
function addPivotLine(metrics, line) {
  const qty = line.finalQty;
  if (line.saleType === "Credit Sale") { metrics.creditQty += qty; metrics.creditAmt += line.amount; }
  else { metrics.paidQty += qty; metrics.paidAmt += line.amount; }
}
function mergePivotMetrics(target, source) {
  target.creditQty += source.creditQty; target.creditAmt += source.creditAmt;
  target.paidQty += source.paidQty; target.paidAmt += source.paidAmt;
}
function avgPrice(amount, qty) { return qty > 0 ? amount / qty : null; }
function pivotVariantKey(line) { return [line.dimensions || "—", line.subType || "—", line.designs || "—", line.majorColor || "—", line.minorColor || "—"].join("||"); }

function buildProductPricePivot(lines) {
  const products = {};
  lines.forEach(line => {
    const product = products[line.productName] || (products[line.productName] = { productName: line.productName, metrics: pivotMetrics(), months: {} });
    addPivotLine(product.metrics, line);
    const month = monthKey(line.date);
    const monthNode = product.months[month] || (product.months[month] = { month, metrics: pivotMetrics(), variants: {} });
    addPivotLine(monthNode.metrics, line);
    const variant = monthNode.variants[pivotVariantKey(line)] || (monthNode.variants[pivotVariantKey(line)] = {
      dimensions: line.dimensions || "—", subType: line.subType || "—", designs: line.designs || "—",
      majorColor: line.majorColor || "—", minorColor: line.minorColor || "—", metrics: pivotMetrics()
    });
    addPivotLine(variant.metrics, line);
  });
  return Object.values(products).sort((a, b) => b.metrics.creditAmt + b.metrics.paidAmt - a.metrics.creditAmt - a.metrics.paidAmt);
}

function pivotMetricCells(metrics) {
  const n = value => value === null ? "—" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return `<td class="num">${n(metrics.creditQty)}</td><td class="num">${metrics.creditQty ? fmtRupee(avgPrice(metrics.creditAmt, metrics.creditQty)) : "—"}</td><td class="num">${n(metrics.paidQty)}</td><td class="num">${metrics.paidQty ? fmtRupee(avgPrice(metrics.paidAmt, metrics.paidQty)) : "—"}</td>`;
}

function renderProductPricePivot(containerId, lines) {
  const container = document.getElementById(containerId);
  const query = productPricePivotState.search.trim().toLowerCase();
  const products = buildProductPricePivot(lines).filter(p => !query || JSON.stringify(p).toLowerCase().includes(query));
  const rows = [];
  const exportRows = [];
  const exportColumns = [
    { key: "pivotItem", label: "Pivot Item" }, { key: "productMonth", label: "Product / Month" },
    { key: "subType", label: "Subtype" }, { key: "design", label: "Design" },
    { key: "majorColor", label: "Major Color" }, { key: "minorColor", label: "Minor Color" },
    { key: "creditQty", label: "Credit Qty", numeric: true }, { key: "creditAvgPrice", label: "Credit Avg Price", numeric: true },
    { key: "paidQty", label: "Paid Qty", numeric: true }, { key: "paidAvgPrice", label: "Paid Avg Price", numeric: true }
  ];
  const addExportRow = (pivotItem, productMonth, subType, design, majorColor, minorColor, metrics) => exportRows.push({
    pivotItem, productMonth, subType, design, majorColor, minorColor,
    creditQty: metrics.creditQty, creditAvgPrice: avgPrice(metrics.creditAmt, metrics.creditQty),
    paidQty: metrics.paidQty, paidAvgPrice: avgPrice(metrics.paidAmt, metrics.paidQty)
  });
  products.forEach(product => {
    const productKey = `product:${product.productName}`;
    const productOpen = productPricePivotState.expanded.has(productKey);
    rows.push(`<tr class="pivot-row pivot-level-0"><td class="pivot-label"><button class="pivot-toggle" data-pivot-toggle="${productKey}" aria-expanded="${productOpen}">${productOpen ? "▾" : "▸"}</button><strong>${product.productName}</strong></td><td>All months</td><td>All variants</td><td>—</td><td>—</td><td>—</td>${pivotMetricCells(product.metrics)}</tr>`);
    addExportRow(product.productName, "All months", "All variants", "—", "—", "—", product.metrics);
    if (!productOpen) return;
    Object.values(product.months).sort((a, b) => b.month.localeCompare(a.month)).forEach(month => {
      const monthKeyValue = `${productKey}|month:${month.month}`;
      const monthOpen = productPricePivotState.expanded.has(monthKeyValue);
      rows.push(`<tr class="pivot-row pivot-level-1"><td class="pivot-label"><button class="pivot-toggle" data-pivot-toggle="${monthKeyValue}" aria-expanded="${monthOpen}">${monthOpen ? "▾" : "▸"}</button>${monthLabel(month.month)}</td><td>${product.productName}</td><td>All variants</td><td>—</td><td>—</td><td>—</td>${pivotMetricCells(month.metrics)}</tr>`);
      addExportRow(monthLabel(month.month), product.productName, "All variants", "—", "—", "—", month.metrics);
      if (!monthOpen) return;
      Object.values(month.variants).sort((a, b) => b.metrics.creditAmt + b.metrics.paidAmt - a.metrics.creditAmt - a.metrics.paidAmt).forEach(variant => {
        rows.push(`<tr class="pivot-row pivot-level-2 pivot-leaf"><td class="pivot-label"><span class="pivot-spacer"></span>${variant.dimensions}</td><td>${product.productName}</td><td>${variant.subType}</td><td>${variant.designs}</td><td>${variant.majorColor}</td><td>${variant.minorColor}</td>${pivotMetricCells(variant.metrics)}</tr>`);
        addExportRow(variant.dimensions, product.productName, variant.subType, variant.designs, variant.majorColor, variant.minorColor, variant.metrics);
      });
    });
  });
  container.innerHTML = `<div class="table-toolbar"><div class="table-toolbar-left"><strong style="font-size:12.5px;color:var(--ink-soft)">${exportRows.length.toLocaleString('en-IN')} visible pivot rows</strong><button type="button" class="btn btn-outline btn-sm pivot-export-btn">Download Excel</button></div></div><div class="table-scroll product-pivot-scroll"><table class="data-table product-pivot-table"><thead><tr><th>Pivot Item</th><th>Product / Month</th><th>Subtype</th><th>Design</th><th>Major Color</th><th>Minor Color</th><th>Credit Qty</th><th>Credit Avg Price</th><th>Paid Qty</th><th>Paid Avg Price</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="10" class="empty-note">No rows match the current slicers.</td></tr>`}</tbody></table></div>`;
  container.querySelector(".pivot-export-btn")?.addEventListener("click", () => downloadExcelFile("product_price_pivot", exportColumns, exportRows));
  container.querySelectorAll("[data-pivot-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.pivotToggle;
    if (productPricePivotState.expanded.has(key)) productPricePivotState.expanded.delete(key); else productPricePivotState.expanded.add(key);
    renderProductPricePivot(containerId, lines);
  }));
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
  // Credit-vs-Paid is a sales analysis: never include in-progress orders.
  // Payments and returns shown below are the amounts allocated to each delivered
  // bill by the model's documented oldest-bill-first (FIFO) method.
  const bills = filterBills(DB.bills, f).filter(b => b.isDelivered);
  const filteredOrderIds = new Set(bills.map(b => b.orderId));
  const lines = filterOrderLines(DB.orderLines, f).filter(l => filteredOrderIds.has(l.orderUid) && l.isDelivered);

  const creditBills = bills.filter(b => b.saleType === "Credit Sale");
  const paidBills = bills.filter(b => b.saleType === "Paid Sale");
  const creditValue = creditBills.reduce((s, b) => s + b.billValue, 0);
  const paidValue = paidBills.reduce((s, b) => s + b.billValue, 0);
  const creditPayments = creditBills.reduce((s, b) => s + b.paidAmount, 0);
  const paidPayments = paidBills.reduce((s, b) => s + b.paidAmount, 0);
  const creditReturns = creditBills.reduce((s, b) => s + b.returnedAmount, 0);
  const paidReturns = paidBills.reduce((s, b) => s + b.returnedAmount, 0);
  const creditBalance = creditBills.reduce((s, b) => s + (b.billValue - b.paidAmount - b.returnedAmount), 0);
  const paidBalance = paidBills.reduce((s, b) => s + (b.billValue - b.paidAmount - b.returnedAmount), 0);
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
    const c = (custMap[b.customerKey] = custMap[b.customerKey] || {
      customerName: b.customerName, customerKey: b.customerKey,
      creditValue: 0, creditPayments: 0, creditReturns: 0, creditBalance: 0, creditCount: 0,
      paidValue: 0, paidPayments: 0, paidReturns: 0, paidBalance: 0, paidCount: 0
    });
    const prefix = b.saleType === "Credit Sale" ? "credit" : "paid";
    c[`${prefix}Value`] += b.billValue;
    c[`${prefix}Payments`] += b.paidAmount;
    c[`${prefix}Returns`] += b.returnedAmount;
    c[`${prefix}Balance`] += b.billValue - b.paidAmount - b.returnedAmount;
    c[`${prefix}Count`] += 1;
  });
  const custRows = Object.values(custMap).sort((a, b) => b.creditValue - a.creditValue);

  const productPriceFilterModel = prepareProductPriceFilters(lines);
  const priceLines = productPriceFilterModel.lines;

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Credit Order Value", fmtRupee(creditValue), creditBills.length + " delivered orders", "clay")}
      ${kpiCard("Credit Payments", fmtRupee(creditPayments), "received against credit orders", "sage")}
      ${kpiCard("Credit Stock Returns", fmtRupee(creditReturns), "received against credit orders", "amber")}
      ${kpiCard("Credit Balance", fmtRupee(creditBalance), "order value − payment − return", "clay")}
      ${kpiCard("Paid Order Value", fmtRupee(paidValue), paidBills.length + " delivered orders", "sage")}
      ${kpiCard("Paid Payments", fmtRupee(paidPayments), "received against paid orders", "sage")}
      ${kpiCard("Paid Stock Returns", fmtRupee(paidReturns), "received against paid orders", "amber")}
      ${kpiCard("Paid Balance", fmtRupee(paidBalance), "order value − payment − return", "sage")}
      ${kpiCard("Credit Share", totalValue ? ((creditValue / totalValue) * 100).toFixed(1) + "%" : "—", "of delivered order value")}
    </div>
    <p class="small-note" style="margin-top:-10px;margin-bottom:16px">
      This report includes <strong>delivered orders only</strong>. Payment and stock-return amounts are the amounts allocated to each delivered bill using oldest-bill-first (FIFO), because the source sheets do not contain a bill reference. Classification is decided at the time of the order: same-day payment covering the bill makes it a Paid Sale; otherwise it is a Credit Sale.
    </p>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Credit vs Paid — Monthly Trend</div><div class="panel-note">Delivered orders only</div></div>
        <div class="chart-wrap"><canvas id="chartCreditTrend"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Credit vs Paid — Split</div><div class="panel-note">Delivered order value</div></div>
        <div class="chart-wrap"><canvas id="chartCreditSplit"></canvas></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Delivered Order-wise Credit vs Paid Breakup (${bills.length})</div><div class="panel-note">Payment received and stock return received are shown per delivered order</div></div>
      <div id="creditOrderTable"></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Delivered Customer-wise Credit vs Paid Breakup</div><div class="panel-note">All values are limited to delivered orders</div></div>
      <div id="creditCustTable"></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Product-wise Average Price — Credit vs Paid (by month)</div><div class="panel-note">Delivered orders only; use the slicers to compare dimensions, subtype, product, design, and colors.</div></div>
      <div class="inline-filterbar product-price-filters">
        <div class="filter-group"><label>Dimension</label>${dependentSelectHtml("cpf_dims", productPriceFilterModel.options.dimensions, productPriceFilterState.dimensions)}</div>
        <div class="filter-group"><label>Subtype</label>${dependentSelectHtml("cpf_subtypes", productPriceFilterModel.options.subTypes, productPriceFilterState.subTypes)}</div>
        <div class="filter-group"><label>Product Name</label>${dependentSelectHtml("cpf_products", productPriceFilterModel.options.productNames, productPriceFilterState.productNames)}</div>
        <div class="filter-group"><label>Design</label>${dependentSelectHtml("cpf_designs", productPriceFilterModel.options.designs, productPriceFilterState.designs)}</div>
        <div class="filter-group"><label>Major Color</label>${dependentSelectHtml("cpf_major", productPriceFilterModel.options.majorColors, productPriceFilterState.majorColors)}</div>
        <div class="filter-group"><label>Minor Color</label>${dependentSelectHtml("cpf_minor", productPriceFilterModel.options.minorColors, productPriceFilterState.minorColors)}</div>
        <div class="filter-group"><label>Pivot Search</label><input id="cpf_search" type="search" placeholder="Search product or variant…" value="${productPricePivotState.search}"></div>
        <div class="filter-group filter-actions"><button id="cpf_clear" class="btn btn-ghost btn-sm">Clear</button></div>
      </div>
      <div class="pivot-help">Click <strong>▸</strong> to expand a product, then a month. Click <strong>▾</strong> to collapse. Variant rows show Dimension, Subtype, Design, Major Color, and Minor Color.</div>
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
      { key: "billValue", label: "Order Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "paidAmount", label: "Payment Received", numeric: true, render: r => fmtRupee(r.paidAmount) },
      { key: "returnedAmount", label: "Stock Return Received", numeric: true, render: r => fmtRupee(r.returnedAmount) },
      { key: "netBalance", label: "Balance After Payment & Return", numeric: true, render: r => `<strong>${fmtRupee(r.netBalance)}</strong>` },
      { key: "saleType", label: "Type", render: r => `<span class="tag ${r.saleType === "Credit Sale" ? "tag-pending" : "tag-paid"}">${r.saleType}</span>` },
      { key: "status", label: "Payment Status", render: r => statusTag(r.status) }
    ],
    rows: bills.map(b => ({ ...b, netBalance: +(b.billValue - b.paidAmount - b.returnedAmount).toFixed(2) })),
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey, row.orderId)
  });

  renderDataTable("creditCustTable", {
    searchPlaceholder: "Search customer…", pageSize: 12,
    columns: [
      { key: "customerName", label: "Customer" },
      { key: "creditCount", label: "Credit Orders", numeric: true },
      { key: "creditValue", label: "Credit Order Value", numeric: true, render: r => fmtRupee(r.creditValue) },
      { key: "creditPayments", label: "Credit Payments", numeric: true, render: r => fmtRupee(r.creditPayments) },
      { key: "creditReturns", label: "Credit Stock Returns", numeric: true, render: r => fmtRupee(r.creditReturns) },
      { key: "creditBalance", label: "Credit Balance", numeric: true, render: r => `<strong>${fmtRupee(r.creditBalance)}</strong>` },
      { key: "paidCount", label: "Paid Orders", numeric: true },
      { key: "paidValue", label: "Paid Order Value", numeric: true, render: r => fmtRupee(r.paidValue) },
      { key: "paidPayments", label: "Paid Payments", numeric: true, render: r => fmtRupee(r.paidPayments) },
      { key: "paidReturns", label: "Paid Stock Returns", numeric: true, render: r => fmtRupee(r.paidReturns) },
      { key: "paidBalance", label: "Paid Balance", numeric: true, render: r => `<strong>${fmtRupee(r.paidBalance)}</strong>` }
    ],
    rows: custRows,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey)
  });

  renderProductPricePivot("creditProductTable", priceLines);
  document.getElementById("cpf_search").addEventListener("input", e => {
    productPricePivotState.search = e.target.value;
    renderProductPricePivot("creditProductTable", priceLines);
  });

  PRODUCT_PRICE_FILTERS.forEach(([stateKey, , id]) => {
    document.getElementById(id).addEventListener("change", e => {
      productPriceFilterState[stateKey] = e.target.value;
      renderCreditPaid(DB, f);
    });
  });
  document.getElementById("cpf_clear").addEventListener("click", () => {
    Object.keys(productPriceFilterState).forEach(key => { productPriceFilterState[key] = ""; });
    productPricePivotState.search = "";
    productPricePivotState.expanded.clear();
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
  const payments = DB.payments.filter(p => p.customerKey === customerKey).sort((a, b) => b.date - a.date);
  const returns = DB.stockReturns.filter(r => r.customerKey === customerKey).sort((a, b) => b.date - a.date);
  if (!bills.length && !payments.length && !returns.length) return;
  const custName = bills[0]?.customerName || payments[0]?.customerName || returns[0]?.customerName || customerKey;
  const totalBilled = bills.reduce((s, b) => s + b.billValue, 0);
  // Drill-down totals use raw source receipts, not only amounts allocated to bills.
  // This keeps excess payments/returns visible as customer surplus/advance.
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const totalReturned = returns.reduce((s, r) => s + r.amount, 0);
  const netOutstanding = +(totalBilled - totalPaid - totalReturned).toFixed(2);
  const totalOutstanding = Math.max(0, netOutstanding);
  const totalSurplus = Math.max(0, -netOutstanding);
  const allocatedPaid = bills.reduce((s, b) => s + b.paidAmount, 0);
  const allocatedReturned = bills.reduce((s, b) => s + b.returnedAmount, 0);
  const excessPaid = Math.max(0, +(totalPaid - allocatedPaid).toFixed(2));
  const excessReturned = Math.max(0, +(totalReturned - allocatedReturned).toFixed(2));
  const historySaes = Array.from(new Set([
    ...bills.map(b => b.sae), ...payments.map(p => p.sae), ...returns.map(r => r.sae)
  ].filter(Boolean))).join(", ");

  openModal(`
    <h2 style="margin:0 0 4px;color:var(--navy)">${custName}</h2>
    <p class="small-note" style="margin-bottom:16px">SAE(s) across history: ${historySaes || "—"}</p>
    <div class="kpi-grid" style="margin-bottom:18px">
      ${kpiCard("Total Billed", fmtRupee(totalBilled))}
      ${kpiCard("Total Paid", fmtRupee(totalPaid), "all source payments", "sage")}
      ${kpiCard("Returned", fmtRupee(totalReturned), "all source returns", "amber")}
      ${kpiCard("Outstanding", fmtRupee(totalOutstanding), "after payment + return", "clay")}
      ${kpiCard("Surplus / Advance", fmtRupee(totalSurplus), "excess payment/return", "amber")}
    </div>
    <p class="small-note" style="margin:-4px 0 16px">${!bills.length ? "No orders are recorded for this customer. The receipt history below is retained as payment/return-only activity." : `Raw receipts exceed bill allocations by ${fmtRupee(excessPaid + excessReturned)} (${fmtRupee(excessPaid)} excess payment and ${fmtRupee(excessReturned)} excess return).`}</p>
    <div class="panel-title" style="margin-bottom:8px">Bill-wise ledger</div>
    <div id="modalLedgerTable" style="margin-bottom:20px"></div>
    <div class="panel-title" style="margin-bottom:8px">Payment history</div>
    <div id="modalPaymentTable" style="margin-bottom:20px"></div>
    <div class="panel-title" style="margin-bottom:8px">Stock return history</div>
    <div id="modalReturnTable"></div>
  `);

  renderDataTable("modalLedgerTable", {
    searchPlaceholder: false, pageSize: 8,
    columns: [
      { key: "orderId", label: "Order ID" },
      { key: "billDate", label: "Date", render: r => formatDate(r.billDate) },
      { key: "billValue", label: "Bill Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "paidAmount", label: "Allocated Paid", numeric: true, render: r => fmtRupee(r.paidAmount) },
      { key: "returnedAmount", label: "Allocated Returned", numeric: true, render: r => fmtRupee(r.returnedAmount) },
      { key: "pendingBalance", label: "Pending", numeric: true, render: r => `<strong>${fmtRupee(r.pendingBalance)}</strong>` },
      { key: "ageDays", label: "Age", numeric: true, render: r => r.ageDays ?? "—" },
      { key: "status", label: "Status", render: r => statusTag(r.status) }
    ],
    rows: bills
  });
  renderDataTable("modalPaymentTable", {
    searchPlaceholder: false, pageSize: 8,
    columns: [
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "sae", label: "SAE" }, { key: "via", label: "Mode" },
      { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
    ], rows: payments
  });
  renderDataTable("modalReturnTable", {
    searchPlaceholder: false, pageSize: 8,
    columns: [
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "sae", label: "SAE" }, { key: "productName", label: "Product" },
      { key: "qty", label: "Qty", numeric: true },
      { key: "amount", label: "Amount", numeric: true, render: r => fmtRupee(r.amount) }
    ], rows: returns
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
