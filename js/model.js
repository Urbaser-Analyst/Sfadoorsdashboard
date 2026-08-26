/* =====================================================================
   MODEL — turns the 5 raw sheets into a clean, linked dataset:
     orders (bills) ⟶ order lines (products) via Order ID = Order UID
     payments & stock returns ⟶ customer, allocated to bills FIFO
     Customer Master ⟶ canonical customer key

   ALLOCATION METHOD (documented + shown in the UI):
   Payments and returns are not tagged to a specific bill in the source
   sheets, so each customer's payments+returns are applied to their
   oldest unpaid bill first, then the next, and so on ("oldest-bill-
   first" / FIFO). This is a standard assumption for lump-sum paying
   customers and is clearly labelled everywhere it drives a number.
   ===================================================================== */

function normName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toUpperCase();
}
function cleanStr(s) {
  return String(s === undefined || s === null ? "" : s).trim();
}
function toNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

function buildModel(raw) {
  // ---------- ORDER (bills) ----------
  const oMap = headerMap(raw.order.fields);
  const oCols = {
    id: pick(oMap, "Order ID", "OrderID"),
    timestamp: pick(oMap, "Timestamp"),
    customer: pick(oMap, "Customer Name"),
    mobile: pick(oMap, "Customer Mobile Number"),
    sae: pick(oMap, "SAE"),
    deliveryDate: pick(oMap, "Delivery Date"),
    ddTimestamp: pick(oMap, "DD Timestamp"),
    deliveryMode: pick(oMap, "Delivery Mode"),
    deliveryStatus: pick(oMap, "Delivery Status"),
    approvalStatus: pick(oMap, "Approval Status"),
    verificationStatus: pick(oMap, "Verification Status"),
    productionStatus: pick(oMap, "Production Status"),
    orderValue: pick(oMap, "Order Value"),
    quotationNo: pick(oMap, "Quotation No"),
    transport: pick(oMap, "Transport Charges"),
    packing: pick(oMap, "Packing Charges"),
    loading: pick(oMap, "Loading Charges"),
    other: pick(oMap, "Other Charges")
  };

  const orders = raw.order.rows
    .filter(r => cleanStr(r[oCols.id]))
    .map(r => {
      const orderDate = parseFlexibleDate(r[oCols.timestamp]);
      const deliveryDate = parseFlexibleDate(r[oCols.deliveryDate]) || parseFlexibleDate(r[oCols.ddTimestamp]);
      return {
        orderId: cleanStr(r[oCols.id]),
        customerName: cleanStr(r[oCols.customer]),
        customerKey: normName(r[oCols.customer]),
        mobile: cleanStr(r[oCols.mobile]),
        sae: cleanStr(r[oCols.sae]) || "Unassigned",
        orderDate,
        deliveryDate: deliveryDate || orderDate,
        billDate: deliveryDate || orderDate, // the date the bill "ages" from
        deliveryMode: cleanStr(r[oCols.deliveryMode]) || "Unspecified",
        deliveryStatus: cleanStr(r[oCols.deliveryStatus]) || "Unknown",
        approvalStatus: cleanStr(r[oCols.approvalStatus]),
        verificationStatus: cleanStr(r[oCols.verificationStatus]),
        productionStatus: cleanStr(r[oCols.productionStatus]),
        orderValue: toNumber(r[oCols.orderValue]),
        quotationNo: cleanStr(r[oCols.quotationNo])
      };
    });

  // ---------- ORDER LIST (product lines) ----------
  const olMap = headerMap(raw.orderList.fields);
  const olCols = {
    id: pick(olMap, "ID"),
    orderUid: pick(olMap, "Order UID"),
    product: pick(olMap, "Product Name"),
    subType: pick(olMap, "Sub Type"),
    uom: pick(olMap, "UOM"),
    dimensions: pick(olMap, "Dimensions"),
    designs: pick(olMap, "Designs"),
    majorColor: pick(olMap, "Major Color"),
    minorColor: pick(olMap, "Minor Color"),
    qty: pick(olMap, "Qty"),
    rate: pick(olMap, "Rate"),
    stockReturn: pick(olMap, "Stock Return"),
    finalQty: pick(olMap, "Final Qty"),
    amount: pick(olMap, "Amount"),
    timestamp: pick(olMap, "Timestamp")
  };

  const orderByIdIndex = {};
  orders.forEach(o => { orderByIdIndex[o.orderId] = o; });

  const orderLines = raw.orderList.rows
    .filter(r => cleanStr(r[olCols.orderUid]))
    .map(r => {
      const orderUid = cleanStr(r[olCols.orderUid]);
      const parent = orderByIdIndex[orderUid];
      return {
        id: cleanStr(r[olCols.id]),
        orderUid,
        customerName: parent ? parent.customerName : "",
        customerKey: parent ? parent.customerKey : "",
        sae: parent ? parent.sae : "Unassigned",
        date: parent ? parent.billDate : null,
        deliveryMode: parent ? parent.deliveryMode : "Unspecified",
        productName: cleanStr(r[olCols.product]) || "Unspecified",
        subType: cleanStr(r[olCols.subType]),
        dimensions: cleanStr(r[olCols.dimensions]),
        designs: cleanStr(r[olCols.designs]),
        majorColor: cleanStr(r[olCols.majorColor]),
        minorColor: cleanStr(r[olCols.minorColor]),
        qty: toNumber(r[olCols.qty]),
        rate: toNumber(r[olCols.rate]),
        stockReturnQty: toNumber(r[olCols.stockReturn]),
        finalQty: toNumber(r[olCols.finalQty]) || toNumber(r[olCols.qty]),
        amount: toNumber(r[olCols.amount])
      };
    });

  // ---------- PAYMENTS ----------
  const pMap = headerMap(raw.payments.fields);
  const pCols = {
    id: pick(pMap, "ID"),
    date: pick(pMap, "Date"),
    timestamp: pick(pMap, "Timestamp"),
    sae: pick(pMap, "SAE"),
    cid: pick(pMap, "CID"),
    customer: pick(pMap, "Customer Name"),
    via: pick(pMap, "Via"),
    amount: pick(pMap, "Amount")
  };
  const payments = raw.payments.rows
    .filter(r => cleanStr(r[pCols.customer]))
    .map(r => ({
      id: cleanStr(r[pCols.id]),
      date: parseFlexibleDate(r[pCols.date]) || parseFlexibleDate(r[pCols.timestamp]),
      sae: cleanStr(r[pCols.sae]) || "Unassigned",
      cid: cleanStr(r[pCols.cid]),
      customerName: cleanStr(r[pCols.customer]),
      customerKey: normName(r[pCols.customer]),
      via: cleanStr(r[pCols.via]) || "Unspecified",
      amount: toNumber(r[pCols.amount])
    }))
    .filter(p => p.date);

  // ---------- STOCK RETURN ----------
  const srMap = headerMap(raw.stockReturn.fields);
  const srCols = {
    id: pick(srMap, "ID"),
    date: pick(srMap, "Date"),
    timestamp: pick(srMap, "Timestamp"),
    sae: pick(srMap, "SAE"),
    cid: pick(srMap, "CID"),
    customer: pick(srMap, "Customer Name"),
    product: pick(srMap, "Product Name"),
    subType: pick(srMap, "Sub Type"),
    qty: pick(srMap, "Qty"),
    amount: pick(srMap, "Amount"),
    type: pick(srMap, "Type")
  };
  const stockReturns = raw.stockReturn.rows
    .filter(r => cleanStr(r[srCols.customer]))
    .map(r => ({
      id: cleanStr(r[srCols.id]),
      date: parseFlexibleDate(r[srCols.date]) || parseFlexibleDate(r[srCols.timestamp]),
      sae: cleanStr(r[srCols.sae]) || "Unassigned",
      cid: cleanStr(r[srCols.cid]),
      customerName: cleanStr(r[srCols.customer]),
      customerKey: normName(r[srCols.customer]),
      productName: cleanStr(r[srCols.product]) || "Unspecified",
      subType: cleanStr(r[srCols.subType]),
      qty: toNumber(r[srCols.qty]),
      amount: toNumber(r[srCols.amount]),
      returnType: cleanStr(r[srCols.type]) || "Return"
    }))
    .filter(s => s.date);

  // ---------- CUSTOMER MASTER ----------
  const cmMap = headerMap(raw.customerMaster.fields);
  const cmNameCol = pick(cmMap, "Customer Name", "Name");
  const customerMasterList = raw.customerMaster.rows
    .filter(r => cmNameCol && cleanStr(r[cmNameCol]))
    .map(r => ({ customerName: cleanStr(r[cmNameCol]), customerKey: normName(r[cmNameCol]) }));

  // Canonical customer name lookup: prefer Customer Master's spelling
  const canonicalName = {};
  customerMasterList.forEach(c => { canonicalName[c.customerKey] = c.customerName; });
  function resolveCustomerName(key, fallback) {
    return canonicalName[key] || fallback;
  }
  orders.forEach(o => { o.customerName = resolveCustomerName(o.customerKey, o.customerName); });
  orderLines.forEach(o => { if (o.customerKey) o.customerName = resolveCustomerName(o.customerKey, o.customerName); });
  payments.forEach(p => { p.customerName = resolveCustomerName(p.customerKey, p.customerName); });
  stockReturns.forEach(s => { s.customerName = resolveCustomerName(s.customerKey, s.customerName); });

  // Master customer key set (union of Customer Master + anyone seen in transactions,
  // in case Customer Master is incomplete)
  const allCustomerKeys = new Set([
    ...customerMasterList.map(c => c.customerKey),
    ...orders.map(o => o.customerKey),
    ...payments.map(p => p.customerKey),
    ...stockReturns.map(s => s.customerKey)
  ].filter(Boolean));

  // ---------- FIFO ALLOCATION OF PAYMENTS + RETURNS AGAINST BILLS ----------
  const billsByCustomer = {};
  orders.forEach(o => {
    if (!o.customerKey) return;
    (billsByCustomer[o.customerKey] = billsByCustomer[o.customerKey] || []).push(o);
  });

  const bills = []; // flattened, enriched bill list (one row per order)

  allCustomerKeys.forEach(key => {
    const custBills = (billsByCustomer[key] || []).slice().sort((a, b) => (a.billDate || 0) - (b.billDate || 0));

    const custCredits = []
      .concat(payments.filter(p => p.customerKey === key).map(p => ({ type: "payment", date: p.date, amount: p.amount, sae: p.sae, via: p.via, id: p.id })))
      .concat(stockReturns.filter(s => s.customerKey === key).map(s => ({ type: "return", date: s.date, amount: s.amount, sae: s.sae, via: s.returnType, id: s.id })))
      .sort((a, b) => (a.date || 0) - (b.date || 0));

    // Running allocation: each bill gets a `remaining` pool, credits consumed oldest-bill-first
    custBills.forEach(b => {
      b.remaining = b.orderValue;
      b.allocations = [];
    });

    let billPtr = 0;
    custCredits.forEach(credit => {
      let amountLeft = credit.amount;
      while (amountLeft > 0.005 && billPtr < custBills.length) {
        const bill = custBills[billPtr];
        if (bill.remaining <= 0.005) { billPtr++; continue; }
        const applied = Math.min(bill.remaining, amountLeft);
        bill.remaining -= applied;
        amountLeft -= applied;
        bill.allocations.push({ ...credit, appliedAmount: applied });
        if (bill.remaining <= 0.005) billPtr++;
      }
      credit.unappliedOverflow = amountLeft; // credit exceeds all known bills (advance payment)
    });

    custBills.forEach(b => {
      const paidAmt = b.allocations.filter(a => a.type === "payment").reduce((s, a) => s + a.appliedAmount, 0);
      const returnedAmt = b.allocations.filter(a => a.type === "return").reduce((s, a) => s + a.appliedAmount, 0);
      const pending = Math.max(0, +b.remaining.toFixed(2));
      const ageDays = pending > 0.5 ? daysAgo(b.billDate) : null;
      const lastAllocDate = b.allocations.length ? b.allocations.reduce((m, a) => (a.date > m ? a.date : m), b.allocations[0].date) : null;
      let status = "Pending";
      if (pending <= 0.5) status = "Paid";
      else if (paidAmt + returnedAmt > 0.5) status = "Partially Paid";
      bills.push({
        orderId: b.orderId,
        customerName: b.customerName,
        customerKey: b.customerKey,
        sae: b.sae,
        billDate: b.billDate,
        deliveryMode: b.deliveryMode,
        deliveryStatus: b.deliveryStatus,
        approvalStatus: b.approvalStatus,
        verificationStatus: b.verificationStatus,
        productionStatus: b.productionStatus,
        quotationNo: b.quotationNo,
        billValue: +b.orderValue.toFixed(2),
        paidAmount: +paidAmt.toFixed(2),
        returnedAmount: +returnedAmt.toFixed(2),
        pendingBalance: pending,
        ageDays,
        status,
        lastAllocationDate: lastAllocDate
      });
    });
  });

  // ---------- CUSTOMER SUMMARY (built from bills, so numbers tie to the ledger) ----------
  const customerSummaryMap = {};
  bills.forEach(b => {
    const c = (customerSummaryMap[b.customerKey] = customerSummaryMap[b.customerKey] || {
      customerName: b.customerName,
      customerKey: b.customerKey,
      totalBilled: 0, totalPaid: 0, totalReturned: 0,
      billCount: 0, pendingBillCount: 0,
      oldestPendingAge: null, saeSet: new Set(), lastPaymentDate: null
    });
    c.totalBilled += b.billValue;
    c.totalPaid += b.paidAmount;
    c.totalReturned += b.returnedAmount;
    c.billCount += 1;
    c.saeSet.add(b.sae);
    if (b.pendingBalance > 0.5) {
      c.pendingBillCount += 1;
      if (c.oldestPendingAge === null || (b.ageDays !== null && b.ageDays > c.oldestPendingAge)) c.oldestPendingAge = b.ageDays;
    }
  });
  payments.forEach(p => {
    const c = customerSummaryMap[p.customerKey];
    if (c && (!c.lastPaymentDate || p.date > c.lastPaymentDate)) c.lastPaymentDate = p.date;
  });
  const customerSummaries = Object.values(customerSummaryMap).map(c => ({
    ...c,
    netOutstanding: +(c.totalBilled - c.totalPaid - c.totalReturned).toFixed(2),
    saeList: Array.from(c.saeSet)
  }));

  // ---------- PRODUCT ROLLUP (dimension/color/design agnostic) ----------
  const productMap = {};
  orderLines.forEach(l => {
    const key = normName(l.productName);
    const p = (productMap[key] = productMap[key] || {
      productName: l.productName, qtySold: 0, amountSold: 0, orderCount: 0, variantSet: new Set()
    });
    p.qtySold += l.finalQty || l.qty;
    p.amountSold += l.amount;
    p.orderCount += 1;
    if (l.dimensions || l.majorColor || l.designs) p.variantSet.add([l.dimensions, l.majorColor, l.minorColor, l.designs].filter(Boolean).join(" / "));
  });
  stockReturns.forEach(s => {
    const key = normName(s.productName);
    const p = (productMap[key] = productMap[key] || {
      productName: s.productName, qtySold: 0, amountSold: 0, orderCount: 0, variantSet: new Set()
    });
    p.qtyReturned = (p.qtyReturned || 0) + s.qty;
    p.amountReturned = (p.amountReturned || 0) + s.amount;
  });
  const productRollup = Object.values(productMap).map(p => ({
    ...p,
    qtyReturned: p.qtyReturned || 0,
    amountReturned: p.amountReturned || 0,
    variantCount: p.variantSet.size,
    returnRatePct: p.qtySold > 0 ? +(((p.qtyReturned || 0) / p.qtySold) * 100).toFixed(1) : 0
  }));

  // ---------- FILTER OPTION LISTS ----------
  const saeList = Array.from(new Set([
    ...orders.map(o => o.sae), ...payments.map(p => p.sae), ...stockReturns.map(s => s.sae)
  ].filter(Boolean))).sort();
  const deliveryModeList = Array.from(new Set(orders.map(o => o.deliveryMode).filter(Boolean))).sort();
  const paymentViaList = Array.from(new Set(payments.map(p => p.via).filter(Boolean))).sort();
  const customerNameList = Array.from(allCustomerKeys).map(k => canonicalName[k] || (billsByCustomer[k] && billsByCustomer[k][0].customerName) || k).sort();

  return {
    orders, orderLines, payments, stockReturns,
    bills, customerSummaries, productRollup,
    saeList, deliveryModeList, paymentViaList, customerNameList,
    generatedAt: new Date()
  };
}
