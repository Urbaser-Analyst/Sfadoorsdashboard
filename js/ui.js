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
  const cls = (status === "Paid" || status === "Settled") ? "tag-paid" :
    (status === "Partially Paid" || status === "Partially Settled") ? "tag-partial" : "tag-pending";
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
  else if (view === "quotation") renderQuotation(DB, f);
  else if (view === "products") renderProducts(DB, f);
  else if (view === "payments") renderPayments(DB, f);
  else if (view === "returns") renderReturns(DB, f);
  else if (view === "creditpaid") renderCreditPaid(DB, f);
  else if (view === "activity") renderActivity(DB, f);
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
  // Outstanding cards follow the user’s delivered-only basis: delivered Order Value
  // is netted against all filtered customer payments and stock returns.
  const customerRowsAll = summarizeBillsByCustomer(deliveredBills, payments, returns);
  const totalOutstanding = customerRowsAll.reduce((s, c) => s + c.outstandingExcludingSurplus, 0);
  const totalOutstandingIncludingSurplus = customerRowsAll.reduce((s, c) => s + c.outstandingIncludingSurplus, 0);
  const totalSurplus = customerRowsAll.reduce((s, c) => s + c.surplus, 0);
  const totalReturned = returns.reduce((s, r) => s + r.amount, 0);
  const paymentsPlusReturns = totalCollected + totalReturned;
  const collectionPct = totalBilled > 0 ? ((totalCollected + totalReturned) / totalBilled * 100) : 0;
  const activeCustomers = new Set(deliveredBills.map(b => b.customerKey)).size;
  const avgOrderValue = deliveredBills.length ? totalBilled / deliveredBills.length : 0;
  const salesDays = activeDayCount(deliveredBills, b => b.deliveryDate || b.billDate);
  const paymentDays = activeDayCount(payments, p => p.date);
  const returnDays = activeDayCount(returns, r => r.date);
  const avgSalesPerDay = salesDays ? totalBilled / salesDays : 0;
  const avgPaymentPerDay = paymentDays ? totalCollected / paymentDays : 0;
  const avgReturnPerDay = returnDays ? totalReturned / returnDays : 0;
  const avgDeliveredOrdersPerDay = salesDays ? deliveredBills.length / salesDays : 0;

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
      ${kpiCard("Payments + Stock Returns", fmtRupee(paymentsPlusReturns), "total receipts and adjustments", "sage")}
      ${kpiCard("Pending", fmtRupee(totalOutstanding), activeCustomers + " customers with bills", "clay")}
      ${kpiCard("Overall Outstanding", fmtRupee(totalOutstandingIncludingSurplus), "Order Value − Payment − Return")}
      ${kpiCard("Surplus", fmtRupee(-totalSurplus), "negative customer surplus / advance", "amber")}
      ${kpiCard("Stock Returns", fmtRupee(totalReturned), returns.length + " return entries", "amber")}
      ${kpiCard("Collection %", collectionPct.toFixed(1) + "%", "paid + returned ÷ billed")}
      ${kpiCard("Avg. Bill Value", fmtRupee(avgOrderValue), "")}
      ${kpiCard("Delivered Order Value / Day", fmtRupee(avgSalesPerDay), `${salesDays} active delivery days`, "sage")}
      ${kpiCard("Payment Received / Day", fmtRupee(avgPaymentPerDay), `${paymentDays} active payment days`, "sage")}
      ${kpiCard("Stock Return Value / Day", fmtRupee(avgReturnPerDay), `${returnDays} active return days`, "amber")}
      ${kpiCard("Delivered Orders / Day", avgDeliveredOrdersPerDay.toFixed(2), `${salesDays} active delivery days`, "sage")}
    </div>
    <p class="small-note" style="margin-top:-10px;margin-bottom:16px">Sales Value and outstanding cards use delivered Order Value only. Payments and stock returns are included from their own filtered transaction dates. In Progress cards remain independent of the global date range.</p>
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
    { metric: "Payments + Stock Returns", value: paymentsPlusReturns, detail: "payments plus stock returns" },
    { metric: "Pending", value: totalOutstanding, detail: "positive customer net balances" },
    { metric: "Overall Outstanding", value: totalOutstandingIncludingSurplus, detail: "Order Value − Payment − Return" },
    { metric: "Surplus", value: -totalSurplus, detail: "negative customer net balances" },
    { metric: "Stock Returns", value: totalReturned, detail: `${returns.length} return entries` },
    { metric: "Collection %", value: +collectionPct.toFixed(1), detail: "paid + returned ÷ billed" },
    { metric: "Avg. Bill Value", value: avgOrderValue, detail: "delivered orders" },
    { metric: "Delivered Order Value / Day", value: avgSalesPerDay, detail: `${salesDays} active delivery days` },
    { metric: "Payment Received / Day", value: avgPaymentPerDay, detail: `${paymentDays} active payment days` },
    { metric: "Stock Return Value / Day", value: avgReturnPerDay, detail: `${returnDays} active return days` },
    { metric: "Delivered Orders / Day", value: +avgDeliveredOrdersPerDay.toFixed(2), detail: `${salesDays} active delivery days` }
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
  const deliveredBills = filterBills(DB.bills, f).filter(b => b.isDelivered);
  const payments = filterPayments(DB.payments, f);
  const returns = filterReturns(DB.stockReturns, f);
  const allDateBills = filterBills(DB.bills, { ...f, dateFrom: null, dateTo: null });
  const customerCalc = summarizeBillsByCustomer(deliveredBills, payments, returns);
  const calcByKey = Object.fromEntries(customerCalc.map(c => [c.customerKey, c]));
  const masterList = (DB.customerMasterList || []).map(c => ({ customerName: c.customerName, customerKey: c.customerKey }));
  let masterKeys = masterList.length ? masterList : customerCalc.map(c => ({ customerName: c.customerName, customerKey: c.customerKey }));
  // Bug fix: this table used to always list every Customer Master row, even
  // when the global Customer filter narrowed everything else on this page
  // (e.g. "Order Settlement & Ageing" below). Apply the same customer
  // selection here so both tables filter together.
  if (f.customerKeys && f.customerKeys.size) {
    masterKeys = masterKeys.filter(m => f.customerKeys.has(m.customerKey));
  }
  const customerSummaryRows = masterKeys.map(m => {
    const c = calcByKey[m.customerKey] || { customerName: m.customerName, customerKey: m.customerKey, totalBilled: 0, totalPaid: 0, totalReturned: 0, outstandingIncludingSurplus: 0, outstandingExcludingSurplus: 0, surplus: 0, billCount: 0, pendingBillCount: 0, creditBillCount: 0, paidSaleBillCount: 0, oldestPendingAge: 0 };
    const custDelivered = deliveredBills.filter(b => b.customerKey === m.customerKey);
    const custAll = allDateBills.filter(b => b.customerKey === m.customerKey);
    const inProgress = custAll.filter(b => !b.isDelivered);
    const closedBills = custDelivered.filter(b => b.pendingBalance <= 0.5).length;
    const ages = custDelivered.map(b => b.ageDays).filter(v => v !== null && v !== undefined);
    return { ...c, customerName: m.customerName || c.customerName, totalOrderRaised: custAll.length, closedBills, pendingBills: custDelivered.filter(b => b.pendingBalance > 0.5).length, ageingDays: c.oldestPendingAge || 0, averageOrderValue: custDelivered.length ? c.totalBilled / custDelivered.length : 0, averageAgeingPerOrder: ages.length ? ages.reduce((s, v) => s + v, 0) / ages.length : 0, inProgressOrderValue: inProgress.reduce((s, b) => s + b.billValue, 0), inProgressOrderCount: inProgress.length };
  });

  // One row per order. DB.bills already contains the full-history FIFO
  // allocation, so date/customer filters only decide which order rows are
  // displayed; they never recalculate a partial transaction allocation.
  const rows = deliveredBills
    .map(b => ({
      ...b,
      deliveryDateDisplay: b.deliveryDate || b.billDate,
      quotationNumber: b.quotationNo || "—",
      adjustments: +(b.paidAmount + b.returnedAmount).toFixed(2),
      balance: +b.pendingBalance.toFixed(2),
      settlementStatus: b.settlementStatus || (b.pendingBalance <= 0.5 ? "Settled" : b.paidAmount + b.returnedAmount > 0.5 ? "Partially Settled" : "Outstanding"),
      settlementDate: b.settlementDate || null,
      ageingDays: b.ageingDays ?? (b.pendingBalance > 0.5 ? daysAgo(b.billDate) : 0)
    }))
    .sort((a, b) => (b.deliveryDateDisplay || 0) - (a.deliveryDateDisplay || 0));

  const totalBillValue = rows.reduce((s, r) => s + r.billValue, 0);
  const totalAdjustments = rows.reduce((s, r) => s + r.adjustments, 0);
  const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
  const settledCount = rows.filter(r => r.settlementStatus === "Settled").length;
  const outstandingCount = rows.length - settledCount;

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Order Value", fmtRupee(totalBillValue), `${rows.length} orders`)}
      ${kpiCard("Adjustments", fmtRupee(totalAdjustments), "payments + stock returns", "sage")}
      ${kpiCard("Balance", fmtRupee(totalBalance), `${outstandingCount} outstanding orders`, "clay")}
      ${kpiCard("Settled Orders", settledCount, "fully adjusted orders", "sage")}
      ${kpiCard("Outstanding Orders", outstandingCount, "partially settled + outstanding", "amber")}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">Customer Master Outstanding Summary (${customerSummaryRows.length})</div><div class="panel-note">Every customer from Customer Master. Delivered Order Value, Payments, Stock Return, Pending, and Surplus are calculated at customer level; In Progress metrics ignore the date range.</div></div>
      <div id="customerMasterSummaryTable"></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Order Settlement & Ageing (${rows.length})</div>
        <div class="panel-note">Delivered orders only. Payment and stock-return adjustments use the model’s customer-level FIFO allocation, and the table includes every filtered delivered order across every customer.</div>
      </div>
      <div class="table-scroll" id="orderAgeingTable"></div>
    </div>
  `;

  renderDataTable("customerMasterSummaryTable", {
    searchPlaceholder: "Search customer…", exportName: "customer_master_outstanding", pageSize: 10,
    columns: [
      { key: "customerName", label: "Customer Name" },
      { key: "totalBilled", label: "Delivered Order Value", numeric: true, render: r => fmtRupee(r.totalBilled) },
      { key: "totalPaid", label: "Payments", numeric: true, render: r => fmtRupee(r.totalPaid) },
      { key: "totalReturned", label: "Stock Return", numeric: true, render: r => fmtRupee(r.totalReturned) },
      { key: "receiptsTotal", label: "Payment + Stock Return", numeric: true, render: r => fmtRupee(r.totalPaid + r.totalReturned) },
      { key: "outstandingIncludingSurplus", label: "Overall Outstanding", numeric: true, render: r => fmtRupee(r.outstandingIncludingSurplus) },
      { key: "outstandingExcludingSurplus", label: "Pending", numeric: true, render: r => fmtRupee(r.outstandingExcludingSurplus) },
      { key: "surplus", label: "Surplus", numeric: true, render: r => r.surplus ? fmtRupee(-r.surplus) : "₹0" },
      { key: "totalOrderRaised", label: "Total Order Raised", numeric: true },
      { key: "closedBills", label: "Closed Bills", numeric: true },
      { key: "pendingBills", label: "Pending Bills", numeric: true },
      { key: "creditBillCount", label: "Credit Orders Count", numeric: true },
      { key: "paidSaleBillCount", label: "Paid Orders Count", numeric: true },
      { key: "ageingDays", label: "Ageing Days", numeric: true },
      { key: "averageOrderValue", label: "Average Order Value", numeric: true, render: r => fmtRupee(r.averageOrderValue) },
      { key: "averageAgeingPerOrder", label: "Average Ageing Days / Order", numeric: true, render: r => r.averageAgeingPerOrder.toFixed(2) },
      { key: "inProgressOrderValue", label: "In Progress Order Value", numeric: true, render: r => fmtRupee(r.inProgressOrderValue) },
      { key: "inProgressOrderCount", label: "In Progress Order Count", numeric: true }
    ], rows: customerSummaryRows, onRowClick: row => openCustomerLedger(DB, row.customerKey)
  });

  renderDataTable("orderAgeingTable", {
    searchPlaceholder: "Search customer, Order ID, or quotation…",
    exportName: "customer_order_ageing",
    pageSize: 12,
    columns: [
      { key: "deliveryDateDisplay", label: "Delivery Date", render: r => formatDate(r.deliveryDateDisplay) },
      { key: "orderId", label: "Order ID" },
      { key: "quotationNumber", label: "Quotation No" },
      { key: "customerName", label: "Customer Name" },
      { key: "billValue", label: "Bill Value", numeric: true, render: r => fmtRupee(r.billValue) },
      { key: "sae", label: "SAE" },
      { key: "billType", label: "Bill Type" },
      { key: "adjustments", label: "Adjustments", numeric: true, render: r => fmtRupee(r.adjustments) },
      { key: "balance", label: "Balance", numeric: true, render: r => `<strong>${fmtRupee(r.balance)}</strong>` },
      { key: "settlementStatus", label: "Settlement Status", render: r => statusTag(r.settlementStatus) },
      { key: "settlementDate", label: "Settlement Date", render: r => formatDate(r.settlementDate) },
      { key: "ageingDays", label: "Ageing Days", numeric: true, render: r => r.balance > 0.5 ? `${r.ageingDays} (Current Age)` : r.ageingDays }
    ],
    rows,
    onRowClick: row => openCustomerLedger(DB, row.customerKey)
  });
}

/* ================= OLD CUSTOMER SUMMARY REMOVED ================= */
/* The order-wise settlement ageing table above replaces the former customer-level ageing report. */

/* ================= CUSTOMER OUTSTANDING LEGACY MARKER ================= */
/*
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
*/

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
      // Undelivered orders show a dedicated "Undelivered Orders" tag instead
      // of a payment-settlement status, since settlement isn't meaningful
      // until the order has actually been delivered.
      { key: "status", label: "Status", render: r => r.isDelivered ? statusTag(r.status) : `<span class="tag tag-undelivered">Undelivered Orders</span>` }
    ],
    rows: bills,
    onRowClick: (row) => openCustomerLedger(DB, row.customerKey, row.orderId)
  });
}

/* ================= PRODUCT ANALYSIS ================= */
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

/* ================= PRODUCT ANALYSIS ================= */
const productAnalysisState = {
  saleType: "all", // "all" | "credit" | "paid" — driven by the radio slicer
  productNames: new Set(), subTypes: new Set(), dims: new Set(), designs: new Set(), majorColors: new Set(), minorColors: new Set(),
  includeInProgress: false,
  pivot: { expanded: new Set(), search: "" }
};
// Slicer field order, as requested: Product Name, Sub Type, Dimensions,
// Designs, Major Color, Minor Color. Each is a cascading (Excel-slicer-style)
// searchable multiselect: selecting a value in one narrows the options shown
// in the others, via computeCascadingSlicers().
const PRODUCT_ANALYSIS_FIELDS = [
  { key: "productNames", field: "productName", label: "Product Name", idPrefix: "paf_product" },
  { key: "subTypes", field: "subType", label: "Sub Type", idPrefix: "paf_subtype" },
  { key: "dims", field: "dimensions", label: "Dimensions", idPrefix: "paf_dims" },
  { key: "designs", field: "designs", label: "Designs", idPrefix: "paf_designs" },
  { key: "majorColors", field: "majorColor", label: "Major Color", idPrefix: "paf_major" },
  { key: "minorColors", field: "minorColor", label: "Minor Color", idPrefix: "paf_minor" }
];

function productAnalysisSelections() {
  const sel = {};
  PRODUCT_ANALYSIS_FIELDS.forEach(fd => { sel[fd.key] = productAnalysisState[fd.key]; });
  return sel;
}

// Lines after the global filters + Sale Type radio + in-progress toggle, but
// BEFORE the 6 cascading dimension slicers — this is the base pool each
// slicer's own option list is computed against.
function productAnalysisBaseLines(DB, f) {
  const filteredOrderIds = new Set(filterBills(DB.bills, f).map(b => b.orderId));
  let lines = filterOrderLines(DB.orderLines, f)
    .filter(l => filteredOrderIds.has(l.orderUid) && (productAnalysisState.includeInProgress || l.isDelivered));
  if (productAnalysisState.saleType === "credit") lines = lines.filter(l => l.saleType === "Credit Sale");
  else if (productAnalysisState.saleType === "paid") lines = lines.filter(l => l.saleType === "Paid Sale");
  return lines;
}

function renderProducts(DB, f) {
  const scopeLabel = productAnalysisState.saleType === "credit" ? "Credit Sale" : productAnalysisState.saleType === "paid" ? "Paid Sale" : "Credit + Paid";

  document.getElementById("viewRoot").innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Product Analysis Slicers</div>
        <div class="panel-note">${productAnalysisState.includeInProgress ? "Delivered + in-progress orders" : "Delivered orders only (sold)"} · ${scopeLabel}</div>
      </div>
      <div class="filter-group" style="margin-bottom:14px">
        <label>Sale Type</label>
        ${radioGroupHtml("pa_saletype", [{ value: "all", label: "All" }, { value: "credit", label: "Credit Sale" }, { value: "paid", label: "Paid Sale" }], productAnalysisState.saleType)}
      </div>
      <div class="inline-filterbar">
        ${PRODUCT_ANALYSIS_FIELDS.map(fd => msFieldHtml(fd.idPrefix, fd.label)).join("")}
        <div class="filter-group">
          <label>&nbsp;</label>
          <label style="font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:6px;color:var(--ink)">
            <input type="checkbox" id="pf_includeProgress" ${productAnalysisState.includeInProgress ? "checked" : ""}> Include in-progress orders
          </label>
        </div>
        <div class="filter-group filter-actions"><button id="pf_reset" class="btn btn-ghost btn-sm">Reset Slicers</button></div>
      </div>
    </div>
    <div id="productAnalysisResults"></div>
  `;

  document.querySelectorAll('input[name="pa_saletype"]').forEach(radio => {
    radio.addEventListener("change", (e) => { productAnalysisState.saleType = e.target.value; renderProducts(DB, f); });
  });
  document.getElementById("pf_includeProgress").addEventListener("change", (e) => {
    productAnalysisState.includeInProgress = e.target.checked; renderProducts(DB, f);
  });
  document.getElementById("pf_reset").addEventListener("click", () => {
    productAnalysisState.saleType = "all";
    PRODUCT_ANALYSIS_FIELDS.forEach(fd => productAnalysisState[fd.key].clear());
    productAnalysisState.includeInProgress = false;
    productAnalysisState.pivot.search = ""; productAnalysisState.pivot.expanded.clear();
    renderProducts(DB, f);
  });

  PRODUCT_ANALYSIS_FIELDS.forEach(fd => {
    msFieldWire(fd.idPrefix, () => productAnalysisCascade(DB, f).optionsByField[fd.key], productAnalysisState[fd.key], () => refreshProductAnalysisResults(DB, f));
  });

  refreshProductAnalysisResults(DB, f);
}

function productAnalysisCascade(DB, f) {
  return computeCascadingSlicers(productAnalysisBaseLines(DB, f), PRODUCT_ANALYSIS_FIELDS, productAnalysisSelections());
}

function refreshProductAnalysisResults(DB, f) {
  const { optionsByField, filteredLines: lines } = productAnalysisCascade(DB, f);
  // Refresh each dropdown's option list / toggle label in place — this does
  // NOT touch the panel's open/closed state, so a slicer stays open while
  // the person keeps checking boxes (the earlier native <select> version
  // closed/rebuilt on every click, which felt broken).
  PRODUCT_ANALYSIS_FIELDS.forEach(fd => msFieldRender(fd.idPrefix, optionsByField[fd.key], productAnalysisState[fd.key]));

  // Returns are scoped by product only (Stock Return sheet has no sale-type/dimension detail).
  const scopedProductNames = new Set(lines.map(l => l.productName));
  const returnsInScope = filterReturns(DB.stockReturns, f).filter(r => scopedProductNames.has(r.productName) || !lines.length);

  const map = {};
  lines.forEach(l => {
    const k = l.productName;
    const p = (map[k] = map[k] || { productName: k, qty: 0, amount: 0, orders: new Set(), creditQty: 0, creditAmt: 0, paidQty: 0, paidAmt: 0, returned: 0, returnedAmt: 0 });
    p.qty += l.finalQty; p.amount += l.amount; p.orders.add(l.orderUid);
    if (l.saleType === "Credit Sale") { p.creditQty += l.finalQty; p.creditAmt += l.amount; } else { p.paidQty += l.finalQty; p.paidAmt += l.amount; }
  });
  returnsInScope.forEach(r => {
    const k = r.productName;
    const p = (map[k] = map[k] || { productName: k, qty: 0, amount: 0, orders: new Set(), creditQty: 0, creditAmt: 0, paidQty: 0, paidAmt: 0, returned: 0, returnedAmt: 0 });
    p.returned += r.qty; p.returnedAmt += r.amount;
  });
  const rows = Object.values(map).map(p => ({
    ...p, orderCount: p.orders.size,
    returnRatePct: p.qty > 0 ? +((p.returned / p.qty) * 100).toFixed(1) : 0
  })).sort((a, b) => b.amount - a.amount);

  const topByQty = rows.slice().sort((a, b) => b.qty - a.qty).slice(0, 10);
  const topByValue = rows.slice(0, 10);

  // ---- Small summary / KPI cards — all driven by the slicers above ----
  const totalQty = lines.reduce((s, l) => s + l.finalQty, 0);
  const totalValue = lines.reduce((s, l) => s + l.amount, 0);
  const totalOrders = new Set(lines.map(l => l.orderUid)).size;
  const distinctProducts = rows.length;
  const avgPriceOverall = totalQty > 0 ? totalValue / totalQty : 0;
  const creditQty = lines.filter(l => l.saleType === "Credit Sale").reduce((s, l) => s + l.finalQty, 0);
  const creditAmt = lines.filter(l => l.saleType === "Credit Sale").reduce((s, l) => s + l.amount, 0);
  const paidQty = lines.filter(l => l.saleType === "Paid Sale").reduce((s, l) => s + l.finalQty, 0);
  const paidAmt = lines.filter(l => l.saleType === "Paid Sale").reduce((s, l) => s + l.amount, 0);
  const returnedQty = returnsInScope.reduce((s, r) => s + r.qty, 0);
  const returnedAmt = returnsInScope.reduce((s, r) => s + r.amount, 0);
  const returnRateOverall = totalQty > 0 ? +((returnedQty / totalQty) * 100).toFixed(1) : 0;
  const scopeLabel = productAnalysisState.saleType === "credit" ? "Credit Sale" : productAnalysisState.saleType === "paid" ? "Paid Sale" : "Credit + Paid";

  const results = document.getElementById("productAnalysisResults");
  if (!results) return;
  results.innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Qty Sold", totalQty.toLocaleString("en-IN"), scopeLabel, "sage")}
      ${kpiCard("Value Sold", fmtRupee(totalValue), `${totalOrders} orders · ${distinctProducts} products`, "sage")}
      ${kpiCard("Avg. Price / Unit", fmtRupee(avgPriceOverall), "value ÷ qty in current scope")}
      ${kpiCard("Credit Sale", fmtRupee(creditAmt), `${creditQty.toLocaleString("en-IN")} units`, "clay")}
      ${kpiCard("Paid Sale", fmtRupee(paidAmt), `${paidQty.toLocaleString("en-IN")} units`, "sage")}
      ${kpiCard("Qty Returned", returnedQty.toLocaleString("en-IN"), fmtRupee(returnedAmt), "amber")}
      ${kpiCard("Return Rate", returnRateOverall + "%", "returned ÷ sold qty", "amber")}
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
      <div class="panel-header">
        <div class="panel-title">Product Pivot (${rows.length} products)</div>
        <div class="panel-note">Click ▸ to expand a product, then a month, down to Dimension / Subtype / Design / Color variants. Reflects the Sale Type radio and slicers above.</div>
      </div>
      <div class="filter-group" style="max-width:320px;margin-bottom:10px"><input id="pa_pivotSearch" type="search" class="ms-search" placeholder="Search product or variant…" value="${productAnalysisState.pivot.search.replace(/"/g, '&quot;')}"></div>
      <div id="productPivotTable"></div>
    </div>

    <div class="panel">
      <div class="panel-header"><div class="panel-title">Product Detail (${rows.length})</div><div class="panel-note">Click a row to see its dimension / color variants</div></div>
      <div id="productTable"></div>
    </div>
  `;

  makeBarChart("chartProdQty", topByQty.map(p => p.productName.slice(0, 20)), [{ label: "Qty", data: topByQty.map(p => p.qty), backgroundColor: CHART_PALETTE[0] }], { horizontal: true });
  makeBarChart("chartProdVal", topByValue.map(p => p.productName.slice(0, 20)), [{ label: "Value", data: topByValue.map(p => p.amount), backgroundColor: CHART_PALETTE[1] }], { horizontal: true });

  renderProductAnalysisPivot("productPivotTable", lines);

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

  document.getElementById("pa_pivotSearch").addEventListener("input", (e) => {
    productAnalysisState.pivot.search = e.target.value;
    renderProductAnalysisPivot("productPivotTable", lines);
  });
}

/* ---- Product Analysis pivot: Product -> Month -> Variant, expand/collapse ---- */
function paPivotMetrics() { return { qty: 0, amount: 0 }; }
function paAddPivotLine(metrics, line) { metrics.qty += line.finalQty; metrics.amount += line.amount; }

function buildProductAnalysisPivot(lines) {
  const products = {};
  lines.forEach(line => {
    const product = products[line.productName] || (products[line.productName] = { productName: line.productName, metrics: paPivotMetrics(), months: {} });
    paAddPivotLine(product.metrics, line);
    const month = monthKey(line.date);
    const monthNode = product.months[month] || (product.months[month] = { month, metrics: paPivotMetrics(), variants: {} });
    paAddPivotLine(monthNode.metrics, line);
    const vKey = pivotVariantKey(line);
    const variant = monthNode.variants[vKey] || (monthNode.variants[vKey] = {
      dimensions: line.dimensions || "—", subType: line.subType || "—", designs: line.designs || "—",
      majorColor: line.majorColor || "—", minorColor: line.minorColor || "—", metrics: paPivotMetrics()
    });
    paAddPivotLine(variant.metrics, line);
  });
  return Object.values(products).sort((a, b) => b.metrics.amount - a.metrics.amount);
}

function paMetricCells(metrics) {
  const n = value => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const avg = metrics.qty > 0 ? metrics.amount / metrics.qty : null;
  return `<td class="num">${n(metrics.qty)}</td><td class="num">${fmtRupee(metrics.amount)}</td><td class="num">${avg === null ? "—" : fmtRupee(avg)}</td>`;
}

function renderProductAnalysisPivot(containerId, lines) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const query = productAnalysisState.pivot.search.trim().toLowerCase();
  const products = buildProductAnalysisPivot(lines).filter(p => !query || JSON.stringify(p).toLowerCase().includes(query));
  const rows = [];
  const exportRows = [];
  const exportColumns = [
    { key: "pivotItem", label: "Pivot Item" }, { key: "productMonth", label: "Product / Month" },
    { key: "subType", label: "Subtype" }, { key: "design", label: "Design" },
    { key: "majorColor", label: "Major Color" }, { key: "minorColor", label: "Minor Color" },
    { key: "qty", label: "Qty", numeric: true }, { key: "amount", label: "Value", numeric: true },
    { key: "avgPrice", label: "Avg Price", numeric: true }
  ];
  const addExportRow = (pivotItem, productMonth, subType, design, majorColor, minorColor, metrics) => exportRows.push({
    pivotItem, productMonth, subType, design, majorColor, minorColor,
    qty: metrics.qty, amount: metrics.amount, avgPrice: metrics.qty > 0 ? metrics.amount / metrics.qty : null
  });

  products.forEach(product => {
    const productKey = `product:${product.productName}`;
    const productOpen = productAnalysisState.pivot.expanded.has(productKey);
    rows.push(`<tr class="pivot-row pivot-level-0"><td class="pivot-label"><button class="pivot-toggle" data-pivot-toggle="${productKey}" aria-expanded="${productOpen}">${productOpen ? "▾" : "▸"}</button><strong>${product.productName}</strong></td><td>All months</td><td>All variants</td><td>—</td><td>—</td><td>—</td>${paMetricCells(product.metrics)}</tr>`);
    addExportRow(product.productName, "All months", "All variants", "—", "—", "—", product.metrics);
    if (!productOpen) return;
    Object.values(product.months).sort((a, b) => b.month.localeCompare(a.month)).forEach(month => {
      const monthKeyValue = `${productKey}|month:${month.month}`;
      const monthOpen = productAnalysisState.pivot.expanded.has(monthKeyValue);
      rows.push(`<tr class="pivot-row pivot-level-1"><td class="pivot-label"><button class="pivot-toggle" data-pivot-toggle="${monthKeyValue}" aria-expanded="${monthOpen}">${monthOpen ? "▾" : "▸"}</button>${monthLabel(month.month)}</td><td>${product.productName}</td><td>All variants</td><td>—</td><td>—</td><td>—</td>${paMetricCells(month.metrics)}</tr>`);
      addExportRow(monthLabel(month.month), product.productName, "All variants", "—", "—", "—", month.metrics);
      if (!monthOpen) return;
      Object.values(month.variants).sort((a, b) => b.metrics.amount - a.metrics.amount).forEach(variant => {
        rows.push(`<tr class="pivot-row pivot-level-2 pivot-leaf"><td class="pivot-label"><span class="pivot-spacer"></span>${variant.dimensions}</td><td>${product.productName}</td><td>${variant.subType}</td><td>${variant.designs}</td><td>${variant.majorColor}</td><td>${variant.minorColor}</td>${paMetricCells(variant.metrics)}</tr>`);
        addExportRow(variant.dimensions, product.productName, variant.subType, variant.designs, variant.majorColor, variant.minorColor, variant.metrics);
      });
    });
  });

  container.innerHTML = `<div class="table-toolbar"><div class="table-toolbar-left"><strong style="font-size:12.5px;color:var(--ink-soft)">${exportRows.length.toLocaleString('en-IN')} visible pivot rows</strong><button type="button" class="btn btn-outline btn-sm pivot-export-btn">Download Excel</button></div></div><div class="table-scroll product-pivot-scroll"><table class="data-table product-pivot-table"><thead><tr><th>Pivot Item</th><th>Product / Month</th><th>Subtype</th><th>Design</th><th>Major Color</th><th>Minor Color</th><th>Qty</th><th>Value</th><th>Avg Price</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="9" class="empty-note">No rows match the current slicers.</td></tr>`}</tbody></table></div>`;
  container.querySelector(".pivot-export-btn")?.addEventListener("click", () => downloadExcelFile("product_analysis_pivot", exportColumns, exportRows));
  container.querySelectorAll("[data-pivot-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.pivotToggle;
    if (productAnalysisState.pivot.expanded.has(key)) productAnalysisState.pivot.expanded.delete(key); else productAnalysisState.pivot.expanded.add(key);
    renderProductAnalysisPivot(containerId, lines);
  }));
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
/* ---- UOM Rate Calculations (Credit vs Paid tab) ----
   Computes a sold-quantity metric per the product's UOM, for delivered
   orders only:
     "SQ.ft" — H and W already in feet:      H × W × Final Qty
     "SQft"  — H and W in inches:            (H × W ÷ 144) × Final Qty
     anything else ("Unit", blank, ...)  —   just Final Qty (no area to compute)
   uomQty is precomputed per line in model.js; this just rolls it up.
   Broken down across Product → Month → SAE (expand/collapse), with
   Customer as an additional slicer — Credit vs Cash side by side at every
   level, so you can see totals for all products, drill into any month, and
   see which SAE it came from. */
function uomComputedQty(line) {
  return (line.uomQty !== null && line.uomQty !== undefined) ? line.uomQty : line.finalQty;
}
const uomCalcState = { sae: new Set(), customer: new Set(), pivot: { expanded: new Set(), search: "" } };
const UOM_CALC_FIELDS = [
  { key: "sae", field: "sae", label: "SAE", idPrefix: "ucf_sae" },
  { key: "customer", field: "customerName", label: "Customer", idPrefix: "ucf_customer" }
];

function uomPivotMetrics() {
  return { creditQty: 0, creditComputedQty: 0, creditAmt: 0, paidQty: 0, paidComputedQty: 0, paidAmt: 0 };
}
function uomAddPivotLine(metrics, line) {
  const computedQty = uomComputedQty(line);
  const prefix = line.saleType === "Credit Sale" ? "credit" : "paid";
  metrics[`${prefix}Qty`] += line.finalQty;
  metrics[`${prefix}ComputedQty`] += computedQty;
  metrics[`${prefix}Amt`] += line.amount;
}
function uomTotalAmt(metrics) { return metrics.creditAmt + metrics.paidAmt; }
function uomMetricCells(metrics) {
  const n = v => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 });
  const creditRate = metrics.creditComputedQty > 0 ? metrics.creditAmt / metrics.creditComputedQty : null;
  const paidRate = metrics.paidComputedQty > 0 ? metrics.paidAmt / metrics.paidComputedQty : null;
  return `<td class="num">${n(metrics.creditQty)}</td><td class="num">${n(metrics.creditComputedQty)}</td><td class="num">${fmtRupee(metrics.creditAmt)}</td><td class="num">${creditRate === null ? "—" : fmtRupee(creditRate)}</td>` +
    `<td class="num">${n(metrics.paidQty)}</td><td class="num">${n(metrics.paidComputedQty)}</td><td class="num">${fmtRupee(metrics.paidAmt)}</td><td class="num">${paidRate === null ? "—" : fmtRupee(paidRate)}</td>`;
}

// Group by Bill Name (e.g. "Membrane Door-81x32"), not raw Product Name —
// otherwise every dimension variant of a product (which usually has a
// different rate) collapses into one indistinguishable row. Then Month,
// then SAE.
function buildUomPivot(lines) {
  const products = {};
  lines.forEach(line => {
    const key = line.billName || line.productName;
    const product = products[key] || (products[key] = { productName: key, uom: line.uom || "Unit", metrics: uomPivotMetrics(), months: {} });
    uomAddPivotLine(product.metrics, line);
    const mKey = monthKey(line.date);
    const monthNode = product.months[mKey] || (product.months[mKey] = { month: mKey, metrics: uomPivotMetrics(), saes: {} });
    uomAddPivotLine(monthNode.metrics, line);
    const saeKey = line.sae || "Unassigned";
    const saeNode = monthNode.saes[saeKey] || (monthNode.saes[saeKey] = { sae: saeKey, metrics: uomPivotMetrics() });
    uomAddPivotLine(saeNode.metrics, line);
  });
  return Object.values(products).sort((a, b) => uomTotalAmt(b.metrics) - uomTotalAmt(a.metrics));
}

function renderUomRateCalc(DB, deliveredLines) {
  const { optionsByField, filteredLines: lines } = computeCascadingSlicers(deliveredLines, UOM_CALC_FIELDS, uomCalcState);
  UOM_CALC_FIELDS.forEach(fd => msFieldRender(fd.idPrefix, optionsByField[fd.key], uomCalcState[fd.key]));

  const query = uomCalcState.pivot.search.trim().toLowerCase();
  const products = buildUomPivot(lines).filter(p => !query || JSON.stringify(p).toLowerCase().includes(query));

  const grandTotal = uomPivotMetrics();
  lines.forEach(l => uomAddPivotLine(grandTotal, l));

  // Extra touch #1: monthly computed-area trend, Credit vs Cash.
  const monthlyArea = {};
  lines.forEach(l => {
    const k = monthKey(l.date);
    const m = (monthlyArea[k] = monthlyArea[k] || { credit: 0, paid: 0 });
    if (l.saleType === "Credit Sale") m.credit += uomComputedQty(l); else m.paid += uomComputedQty(l);
  });
  const areaMonths = Object.keys(monthlyArea).sort();

  // Extra touch #2: top 8 products by total computed quantity (area/units sold).
  const topByComputedQty = Object.values(buildUomPivot(lines)).slice().sort((a, b) =>
    (b.metrics.creditComputedQty + b.metrics.paidComputedQty) - (a.metrics.creditComputedQty + a.metrics.paidComputedQty)
  ).slice(0, 8);

  const container = document.getElementById("uomRateCalcSection");
  if (!container) return;
  container.innerHTML = `
    <div class="panel-header">
      <div class="panel-title">UOM Rate Calculations — Credit vs Cash (${products.length} products)</div>
      <div class="panel-note">Delivered orders only, broken down by Product → Month → SAE. Sold quantity is computed per product's UOM: SQ.ft = H×W×Final Qty, SQft = (H×W÷144)×Final Qty, otherwise Final Qty as-is. Avg Rate = Amount ÷ computed quantity.</div>
    </div>
    <div class="inline-filterbar" style="margin-bottom:14px">
      ${UOM_CALC_FIELDS.map(fd => msFieldHtml(fd.idPrefix, fd.label)).join("")}
      <div class="filter-group filter-actions"><button id="ucf_reset" class="btn btn-ghost btn-sm">Reset</button></div>
    </div>
    <div class="kpi-grid" style="margin-bottom:16px">
      ${kpiCard("Credit Computed Qty", grandTotal.creditComputedQty.toLocaleString("en-IN", { maximumFractionDigits: 1 }), fmtRupee(grandTotal.creditAmt), "clay")}
      ${kpiCard("Cash Computed Qty", grandTotal.paidComputedQty.toLocaleString("en-IN", { maximumFractionDigits: 1 }), fmtRupee(grandTotal.paidAmt), "sage")}
      ${kpiCard("Credit Avg Rate", grandTotal.creditComputedQty > 0 ? fmtRupee(grandTotal.creditAmt / grandTotal.creditComputedQty) : "—", "per computed unit")}
      ${kpiCard("Cash Avg Rate", grandTotal.paidComputedQty > 0 ? fmtRupee(grandTotal.paidAmt / grandTotal.paidComputedQty) : "—", "per computed unit")}
    </div>
    <div class="filter-group" style="max-width:320px;margin-bottom:10px"><input id="uom_pivotSearch" type="search" class="ms-search" placeholder="Search product, month, or SAE…" value="${uomCalcState.pivot.search.replace(/"/g, '&quot;')}"></div>
    <div id="uomPivotTable"></div>

    <div class="grid-2" style="margin-top:18px">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Computed Quantity Trend</div><div class="panel-note">Sqft / units sold by month, Credit vs Cash</div></div>
        <div class="chart-wrap"><canvas id="chartUomTrend"></canvas></div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Top Products by Computed Quantity</div><div class="panel-note">Sqft / units, Credit + Cash combined</div></div>
        <div class="chart-wrap"><canvas id="chartUomTopProducts"></canvas></div>
      </div>
    </div>
  `;

  renderUomPivotTable("uomPivotTable", products, grandTotal);

  makeLineChart("chartUomTrend", areaMonths.map(monthLabel), [
    { label: "Credit", data: areaMonths.map(m => monthlyArea[m].credit) },
    { label: "Cash", data: areaMonths.map(m => monthlyArea[m].paid) }
  ]);
  makeBarChart("chartUomTopProducts", topByComputedQty.map(p => p.productName.slice(0, 20)),
    [{ label: "Computed Qty", data: topByComputedQty.map(p => p.metrics.creditComputedQty + p.metrics.paidComputedQty), backgroundColor: CHART_PALETTE[2] }],
    { horizontal: true });

  document.getElementById("uom_pivotSearch").addEventListener("input", (e) => {
    uomCalcState.pivot.search = e.target.value;
    renderUomRateCalc(DB, deliveredLines);
  });

  UOM_CALC_FIELDS.forEach(fd => {
    msFieldWire(fd.idPrefix, () => computeCascadingSlicers(deliveredLines, UOM_CALC_FIELDS, uomCalcState).optionsByField[fd.key], uomCalcState[fd.key], () => renderUomRateCalc(DB, deliveredLines));
  });
  document.getElementById("ucf_reset").addEventListener("click", () => {
    UOM_CALC_FIELDS.forEach(fd => uomCalcState[fd.key].clear());
    uomCalcState.pivot.search = ""; uomCalcState.pivot.expanded.clear();
    renderUomRateCalc(DB, deliveredLines);
  });
}

function renderUomPivotTable(containerId, products, grandTotal) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const rows = [];
  const exportRows = [];
  const exportColumns = [
    { key: "pivotItem", label: "Pivot Item" }, { key: "context", label: "Product / Month" }, { key: "uom", label: "UOM" },
    { key: "creditQty", label: "Credit Qty", numeric: true }, { key: "creditComputedQty", label: "Credit Computed Qty", numeric: true },
    { key: "creditAmt", label: "Credit Amount", numeric: true }, { key: "creditRate", label: "Credit Avg Rate", numeric: true },
    { key: "paidQty", label: "Cash Qty", numeric: true }, { key: "paidComputedQty", label: "Cash Computed Qty", numeric: true },
    { key: "paidAmt", label: "Cash Amount", numeric: true }, { key: "paidRate", label: "Cash Avg Rate", numeric: true }
  ];
  const addExportRow = (pivotItem, context, uom, metrics) => exportRows.push({
    pivotItem, context, uom,
    creditQty: metrics.creditQty, creditComputedQty: metrics.creditComputedQty, creditAmt: metrics.creditAmt,
    creditRate: metrics.creditComputedQty > 0 ? metrics.creditAmt / metrics.creditComputedQty : null,
    paidQty: metrics.paidQty, paidComputedQty: metrics.paidComputedQty, paidAmt: metrics.paidAmt,
    paidRate: metrics.paidComputedQty > 0 ? metrics.paidAmt / metrics.paidComputedQty : null
  });

  rows.push(`<tr class="pivot-row pivot-level-0" style="font-weight:700;background:var(--surface-2)"><td class="pivot-label">Grand Total</td><td>All products</td><td>—</td>${uomMetricCells(grandTotal)}</tr>`);
  addExportRow("Grand Total", "All products", "—", grandTotal);

  products.forEach(product => {
    const productKey = `uom-product:${product.productName}`;
    const productOpen = uomCalcState.pivot.expanded.has(productKey);
    rows.push(`<tr class="pivot-row pivot-level-0"><td class="pivot-label"><button class="pivot-toggle" data-uom-toggle="${productKey}" aria-expanded="${productOpen}">${productOpen ? "▾" : "▸"}</button><strong>${product.productName}</strong></td><td>All months</td><td>${product.uom}</td>${uomMetricCells(product.metrics)}</tr>`);
    addExportRow(product.productName, "All months", product.uom, product.metrics);
    if (!productOpen) return;
    Object.values(product.months).sort((a, b) => b.month.localeCompare(a.month)).forEach(month => {
      const monthKeyValue = `${productKey}|month:${month.month}`;
      const monthOpen = uomCalcState.pivot.expanded.has(monthKeyValue);
      rows.push(`<tr class="pivot-row pivot-level-1"><td class="pivot-label"><button class="pivot-toggle" data-uom-toggle="${monthKeyValue}" aria-expanded="${monthOpen}">${monthOpen ? "▾" : "▸"}</button>${monthLabel(month.month)}</td><td>${product.productName}</td><td>${product.uom}</td>${uomMetricCells(month.metrics)}</tr>`);
      addExportRow(monthLabel(month.month), product.productName, product.uom, month.metrics);
      if (!monthOpen) return;
      Object.values(month.saes).sort((a, b) => uomTotalAmt(b.metrics) - uomTotalAmt(a.metrics)).forEach(saeNode => {
        rows.push(`<tr class="pivot-row pivot-level-2 pivot-leaf"><td class="pivot-label"><span class="pivot-spacer"></span>${saeNode.sae}</td><td>${product.productName} · ${monthLabel(month.month)}</td><td>${product.uom}</td>${uomMetricCells(saeNode.metrics)}</tr>`);
        addExportRow(saeNode.sae, `${product.productName} · ${monthLabel(month.month)}`, product.uom, saeNode.metrics);
      });
    });
  });

  container.innerHTML = `
    <div class="table-toolbar"><div class="table-toolbar-left"><strong style="font-size:12.5px;color:var(--ink-soft)">${exportRows.length.toLocaleString('en-IN')} visible pivot rows</strong><button type="button" class="btn btn-outline btn-sm uom-export-btn">Download Excel</button></div></div>
    <div class="table-scroll product-pivot-scroll">
      <table class="data-table product-pivot-table">
        <thead>
          <tr>
            <th rowspan="2">Pivot Item</th><th rowspan="2">Product / Month</th><th rowspan="2">UOM</th>
            <th colspan="4" style="text-align:center;background:#fdecea">Credit</th>
            <th colspan="4" style="text-align:center;background:#eaf6ee">Cash</th>
          </tr>
          <tr>
            <th class="num">Qty</th><th class="num">Computed Qty</th><th class="num">Amount</th><th class="num">Avg Rate</th>
            <th class="num">Qty</th><th class="num">Computed Qty</th><th class="num">Amount</th><th class="num">Avg Rate</th>
          </tr>
        </thead>
        <tbody>${rows.join("") || `<tr><td colspan="11" class="empty-note">No delivered lines match the current filters.</td></tr>`}</tbody>
      </table>
    </div>`;

  container.querySelector(".uom-export-btn")?.addEventListener("click", () => downloadExcelFile("uom_rate_calculations", exportColumns, exportRows));
  container.querySelectorAll("[data-uom-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.uomToggle;
    if (uomCalcState.pivot.expanded.has(key)) uomCalcState.pivot.expanded.delete(key); else uomCalcState.pivot.expanded.add(key);
    renderUomPivotTable(containerId, products, grandTotal);
  }));
}

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

    <div class="panel" id="uomRateCalcSection"></div>
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

  renderUomRateCalc(DB, lines);
}

/* Each Entry Statement — chronological, running-balance view of every DELIVERED
   order, plus every payment and stock return, per customer. Previously shown
   inside the Customer Master drill-down modal; now lives here on All Activity
   only. Orders that haven't been delivered yet are intentionally excluded —
   this is a real accounts statement, not a pipeline preview. */
function buildEachEntryStatement(orders, payments, returns) {
  const deliveredOrders = orders.filter(o => o.isDelivered);

  const byCustomer = {};
  const ensure = key => (byCustomer[key] = byCustomer[key] || []);
  deliveredOrders.forEach(b => ensure(b.customerKey).push({
    type: "Delivered", ref: "Order", date: b.billDate, id: b.orderId, billId: b.billId || b.orderId,
    quotationNo: b.quotationNo || "—", value: b.billValue, orderValue: b.billValue, receiptValue: 0,
    customerName: b.customerName, customerKey: b.customerKey, mobile: b.mobile || "", sae: b.sae
  }));
  payments.forEach(p => ensure(p.customerKey).push({
    type: "Payment", ref: "Payment", date: p.date, id: p.id, billId: p.id,
    quotationNo: "—", value: p.amount, orderValue: 0, receiptValue: p.amount,
    customerName: p.customerName, customerKey: p.customerKey, mobile: p.mobile || "", sae: p.sae
  }));
  returns.forEach(r => ensure(r.customerKey).push({
    type: "Return", ref: "Return", date: r.date, id: r.id, billId: r.id,
    quotationNo: "—", value: r.amount, orderValue: 0, receiptValue: r.amount,
    customerName: r.customerName, customerKey: r.customerKey, mobile: r.mobile || "", sae: r.sae
  }));

  const companyName = (typeof CONFIG !== "undefined" && CONFIG.COMPANY_NAME) || "SFA DOORS & PLYWOOD";
  const allRows = [];
  Object.values(byCustomer).forEach(events => {
    events.sort((a, b) => (a.date || 0) - (b.date || 0));
    const fallbackMobile = events.find(e => e.mobile)?.mobile || "—";
    let cOrders = 0, cReceipts = 0;
    events.forEach(e => {
      cOrders += e.orderValue; cReceipts += e.receiptValue;
      const balance = +(cOrders - cReceipts).toFixed(2);
      const mobile = e.mobile || fallbackMobile;
      const bodyLine = e.ref === "Payment" ? `We have received a payment of ${fmtRupeeText(e.value)} on ${formatDate(e.date)}.`
        : e.ref === "Return" ? `We have received a stock return of ${fmtRupeeText(e.value)} on ${formatDate(e.date)}.`
        : `Your bill No. (${e.billId}) dated ${formatDate(e.date)} has been generated for ${fmtRupeeText(e.value)}.`;
      const message = `Dear ${e.customerName},\n${bodyLine} Your updated balance is ${fmtRupeeText(balance)}.\n${companyName}`;
      allRows.push({
        ...e, mobile,
        cumulativeOrderValue: +cOrders.toFixed(2), cumulativeReceipts: +cReceipts.toFixed(2),
        balance, message
      });
    });
  });
  // Running balances are already computed per customer above, so any later
  // re-sort of the table (by date, customer, etc.) stays correct.
  return allRows.sort((a, b) => (b.date || 0) - (a.date || 0));
}

/* ================= ALL ACTIVITY ================= */
function renderActivity(DB, f) {
  const orders = filterBills(DB.bills, f);
  const payments = filterPayments(DB.payments, f);
  const returns = filterReturns(DB.stockReturns, f);
  const delivered = orders.filter(o => o.isDelivered);
  const notDelivered = orders.filter(o => !o.isDelivered);
  const orderValue = orders.reduce((s, o) => s + o.billValue, 0);
  const paymentValue = payments.reduce((s, p) => s + p.amount, 0);
  const returnValue = returns.reduce((s, r) => s + r.amount, 0);
  const activityRows = [
    ...orders.map(o => ({
      activityType: "Order",
      date: o.deliveryDate || o.billDate,
      reference: o.orderId,
      orderId: o.orderId,
      customerName: o.customerName,
      sae: o.sae,
      status: o.isDelivered ? "Delivered" : ((o.deliveryStatus && o.deliveryStatus !== "Unknown") ? o.deliveryStatus : "Not Delivered"),
      orderValue: o.billValue,
      paymentAmount: 0,
      returnAmount: 0
    })),
    ...payments.map(p => ({
      activityType: "Payment",
      date: p.date,
      reference: p.id || "—",
      orderId: "—",
      customerName: p.customerName,
      sae: p.sae,
      status: "Received",
      orderValue: 0,
      paymentAmount: p.amount,
      returnAmount: 0
    })),
    ...returns.map(r => ({
      activityType: "Stock Return",
      date: r.date,
      reference: r.id || "—",
      orderId: "—",
      customerName: r.customerName,
      sae: r.sae,
      status: r.returnType || "Returned",
      orderValue: 0,
      paymentAmount: 0,
      returnAmount: r.amount
    }))
  ].sort((a, b) => (b.date || 0) - (a.date || 0));

  const statementRows = buildEachEntryStatement(orders, payments, returns);

  document.getElementById("viewRoot").innerHTML = `
    <div class="kpi-grid">
      ${kpiCard("Total Activity Rows", activityRows.length, `${orders.length} orders · ${payments.length} payments · ${returns.length} returns`, "sage")}
      ${kpiCard("Total Orders", orders.length, `${delivered.length} delivered · ${notDelivered.length} not delivered`)}
      ${kpiCard("Delivered Orders", delivered.length, fmtRupee(delivered.reduce((s, o) => s + o.billValue, 0)), "sage")}
      ${kpiCard("Not Delivered Orders", notDelivered.length, fmtRupee(notDelivered.reduce((s, o) => s + o.billValue, 0)), "amber")}
      ${kpiCard("Order Value", fmtRupee(orderValue), "all order statuses")}
      ${kpiCard("Payments Received", fmtRupee(paymentValue), `${payments.length} payment entries`, "sage")}
      ${kpiCard("Stock Returns", fmtRupee(returnValue), `${returns.length} return entries`, "amber")}
      ${kpiCard("Payments + Stock Returns", fmtRupee(paymentValue + returnValue), "all filtered receipts", "sage")}
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Orders, Payments & Stock Returns (${activityRows.length})</div>
        <div class="panel-note">Orders include delivered and non-delivered statuses. Click any column heading to sort.</div>
      </div>
      <div id="activityTable"></div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Each Entry Statement (${statementRows.length})</div>
        <div class="panel-note">Delivered orders only, plus every payment and stock return, in date order per customer, with a running Order Value / Payments + Return / Outstanding Balance and a ready-to-send customer message.</div>
      </div>
      <div id="statementTable"></div>
    </div>
  `;

  renderDataTable("activityTable", {
    searchPlaceholder: "Search customer, order ID, or activity…",
    exportName: "orders_payments_stock_returns",
    pageSize: 15,
    columns: [
      { key: "activityType", label: "Activity" },
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "reference", label: "Reference" },
      { key: "orderId", label: "Order ID" },
      { key: "customerName", label: "Customer Name" },
      { key: "sae", label: "SAE" },
      { key: "status", label: "Status", render: r => statusTag(r.status === "Received" ? "Paid" : r.status === "Delivered" ? "Settled" : r.status) },
      { key: "orderValue", label: "Order Value", numeric: true, render: r => r.orderValue ? fmtRupee(r.orderValue) : "—" },
      { key: "paymentAmount", label: "Payment", numeric: true, render: r => r.paymentAmount ? fmtRupee(r.paymentAmount) : "—" },
      { key: "returnAmount", label: "Stock Return", numeric: true, render: r => r.returnAmount ? fmtRupee(r.returnAmount) : "—" }
    ],
    rows: activityRows
  });

  renderDataTable("statementTable", {
    searchPlaceholder: "Search statement…",
    exportName: "customer_entry_statement",
    pageSize: 15,
    columns: [
      { key: "quotationNo", label: "Quotation No" }, { key: "customerName", label: "Customer Name" },
      { key: "type", label: "Type", render: r => statusTag(r.type === "Delivered" ? "Settled" : r.type === "Payment" ? "Paid" : r.type) },
      { key: "date", label: "Date", render: r => formatDate(r.date) },
      { key: "value", label: "Value", numeric: true, render: r => fmtRupee(r.value) },
      { key: "ref", label: "Reference" }, { key: "mobile", label: "Mobile" },
      { key: "cumulativeOrderValue", label: "Order Value", numeric: true, render: r => fmtRupee(r.cumulativeOrderValue) },
      { key: "cumulativeReceipts", label: "Payments + Return", numeric: true, render: r => fmtRupee(r.cumulativeReceipts) },
      { key: "balance", label: "Outstanding Balance", numeric: true, render: r => fmtRupee(r.balance) },
      { key: "message", label: "Message", render: r => `<span style="white-space:pre-line">${r.message}</span>` }, { key: "sae", label: "SAE" }
    ],
    rows: statementRows,
    onRowClick: row => openCustomerLedger(DB, row.customerKey)
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

  // "Each Entry Statement" (the full chronological, running-balance view of
  // every order/payment/return) now lives on the All Activity tab instead
  // of here, so it isn't duplicated per-customer in this drill-down.
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
    <p class="small-note" style="margin:-4px 0 16px">Looking for the full entry-by-entry statement with running balance? It's on the <strong>All Activity</strong> tab.</p>
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
