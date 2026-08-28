/* =====================================================================
   FILTERS — reads the global filter bar and exposes predicate-based
   filtering for each data slice (bills, payments, returns, order lines).
   ===================================================================== */

function readFilterState() {
  const dateFrom = document.getElementById("f_dateFrom").value;
  const dateTo = document.getElementById("f_dateTo").value;
  const customerSearch = document.getElementById("f_customerSearch").value.trim().toLowerCase();
  const saeSelect = document.getElementById("f_sae");
  const saeSet = new Set(Array.from(saeSelect.selectedOptions).map(o => o.value));
  const deliveryStatus = ""; // Delivery Status is no longer a global slicer.
  const ageingMin = +document.getElementById("f_ageing").value || 0;
  const minValue = document.getElementById("f_minValue").value ? +document.getElementById("f_minValue").value : null;
  const paymentVia = document.getElementById("f_paymentVia").value;

  return {
    // Parse date inputs as local calendar dates. Native new Date("YYYY-MM-DD")
    // parses as UTC and can shift 01-Aug to the previous local day.
    dateFrom: dateFrom ? parseFlexibleDate(dateFrom) : null,
    dateTo: dateTo ? parseFlexibleDate(dateTo) : null,
    customerSearch, saeSet, deliveryStatus: "", ageingMin, minValue, paymentVia
  };
}

function inDateRange(date, from, to) {
  if (!date) return !from && !to;
  if (from && date < from) return false;
  if (to) {
    const end = new Date(to); end.setHours(23, 59, 59, 999);
    if (date > end) return false;
  }
  return true;
}

function filterBills(bills, f) {
  return bills.filter(b =>
    inDateRange(b.deliveryDate || b.billDate, f.dateFrom, f.dateTo) &&
    (f.saeSet.size === 0 || f.saeSet.has(b.sae)) &&
    (!f.customerSearch || b.customerName.toLowerCase().includes(f.customerSearch)) &&
    (f.ageingMin === 0 || (b.ageDays !== null && b.ageDays >= f.ageingMin)) &&
    (f.minValue === null || b.pendingBalance >= f.minValue)
  );
}

function filterPayments(payments, f) {
  return payments.filter(p =>
    inDateRange(p.date, f.dateFrom, f.dateTo) &&
    (f.saeSet.size === 0 || f.saeSet.has(p.sae)) &&
    (!f.paymentVia || p.via === f.paymentVia) &&
    (!f.customerSearch || p.customerName.toLowerCase().includes(f.customerSearch))
  );
}

function filterReturns(returns, f) {
  return returns.filter(s =>
    inDateRange(s.date, f.dateFrom, f.dateTo) &&
    (f.saeSet.size === 0 || f.saeSet.has(s.sae)) &&
    (!f.customerSearch || s.customerName.toLowerCase().includes(f.customerSearch))
  );
}

function filterOrderLines(lines, f) {
  return lines.filter(l =>
    inDateRange(l.date, f.dateFrom, f.dateTo) &&
    (f.saeSet.size === 0 || f.saeSet.has(l.sae)) &&
    (!f.customerSearch || l.customerName.toLowerCase().includes(f.customerSearch))
  );
}

// Aggregate filtered orders, payments, and returns at customer level.
// Business rule: Net Outstanding = Order Value - Payment - Return.
// Positive net is Outstanding Excluding Surplus; negative net is customer surplus.
function summarizeBillsByCustomer(bills, payments = [], returns = []) {
  const map = {};
  const ensure = (key, name) => (map[key] = map[key] || {
    customerName: name || key, customerKey: key, totalBilled: 0, totalPaid: 0, totalReturned: 0,
    pendingTotal: 0, billCount: 0, pendingBillCount: 0, creditBillCount: 0, paidSaleBillCount: 0,
    oldestPendingAge: 0, saeSet: new Set()
  });
  bills.forEach(b => {
    if (!b.customerKey) return;
    const c = ensure(b.customerKey, b.customerName);
    c.totalBilled += b.billValue;
    c.billCount += 1;
    c.saeSet.add(b.sae);
    if (b.saleType === "Credit Sale") c.creditBillCount += 1; else c.paidSaleBillCount += 1;
    if (b.pendingBalance > 0.5) {
      c.pendingBillCount += 1;
      if (b.ageDays !== null) c.oldestPendingAge = Math.max(c.oldestPendingAge, b.ageDays);
    }
  });
  payments.forEach(p => {
    if (!p.customerKey) return;
    const c = ensure(p.customerKey, p.customerName);
    c.totalPaid += p.amount;
    if (p.sae) c.saeSet.add(p.sae);
  });
  returns.forEach(r => {
    if (!r.customerKey) return;
    const c = ensure(r.customerKey, r.customerName);
    c.totalReturned += r.amount;
    if (r.sae) c.saeSet.add(r.sae);
  });
  return Object.values(map).map(c => {
    const netOutstanding = +(c.totalBilled - c.totalPaid - c.totalReturned).toFixed(2);
    const outstandingExcludingSurplus = Math.max(0, netOutstanding);
    const surplus = Math.max(0, -netOutstanding);
    return {
      ...c,
      totalBilled: +c.totalBilled.toFixed(2), totalPaid: +c.totalPaid.toFixed(2), totalReturned: +c.totalReturned.toFixed(2),
      saeList: Array.from(c.saeSet), pendingTotal: outstandingExcludingSurplus,
      surplus: +surplus.toFixed(2),
      outstandingExcludingSurplus: +outstandingExcludingSurplus.toFixed(2),
      outstandingIncludingSurplus: netOutstanding,
      netOutstanding
    };
  });
}

function ageingBucket(days) {
  if (days === null || days === undefined) return null;
  if (days <= 10) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  return 3;
}
const AGEING_BUCKET_LABELS = ["0–10 days", "11–30 days", "31–60 days", "60+ days"];
