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
  const deliveryMode = document.getElementById("f_deliveryMode").value;
  const ageingMin = +document.getElementById("f_ageing").value || 0;
  const minValue = document.getElementById("f_minValue").value ? +document.getElementById("f_minValue").value : null;
  const paymentVia = document.getElementById("f_paymentVia").value;

  return {
    dateFrom: dateFrom ? new Date(dateFrom) : null,
    dateTo: dateTo ? new Date(dateTo) : null,
    customerSearch, saeSet, deliveryMode, ageingMin, minValue, paymentVia
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
    inDateRange(b.billDate, f.dateFrom, f.dateTo) &&
    (f.saeSet.size === 0 || f.saeSet.has(b.sae)) &&
    (!f.deliveryMode || b.deliveryMode === f.deliveryMode) &&
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
    (!f.deliveryMode || l.deliveryMode === f.deliveryMode) &&
    (!f.customerSearch || l.customerName.toLowerCase().includes(f.customerSearch))
  );
}

// Aggregate a set of (already filtered) bills back up to one row per customer.
// Used by the Outstanding & Ageing view so every slicer (ageing, value, SAE...)
// reshapes both the bill list and the customer roll-up consistently.
function summarizeBillsByCustomer(bills) {
  const map = {};
  bills.forEach(b => {
    const c = (map[b.customerKey] = map[b.customerKey] || {
      customerName: b.customerName, customerKey: b.customerKey,
      totalBilled: 0, totalPaid: 0, totalReturned: 0, pendingTotal: 0,
      billCount: 0, pendingBillCount: 0, oldestPendingAge: 0, saeSet: new Set()
    });
    c.totalBilled += b.billValue;
    c.totalPaid += b.paidAmount;
    c.totalReturned += b.returnedAmount;
    c.pendingTotal += b.pendingBalance;
    c.billCount += 1;
    c.saeSet.add(b.sae);
    if (b.pendingBalance > 0.5) {
      c.pendingBillCount += 1;
      if (b.ageDays !== null) c.oldestPendingAge = Math.max(c.oldestPendingAge, b.ageDays);
    }
  });
  return Object.values(map).map(c => ({
    ...c,
    saeList: Array.from(c.saeSet),
    pendingTotal: +c.pendingTotal.toFixed(2)
  }));
}

function ageingBucket(days) {
  if (days === null || days === undefined) return null;
  if (days <= 10) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  return 3;
}
const AGEING_BUCKET_LABELS = ["0–10 days", "11–30 days", "31–60 days", "60+ days"];
