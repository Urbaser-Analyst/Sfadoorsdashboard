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
      // Sales/date filtering uses the Order sheet's Delivery Date.
      // DD Timestamp is not a delivery date and is intentionally not used here.
      const deliveryDate = parseFlexibleDate(r[oCols.deliveryDate]);
      const billDate = deliveryDate || orderDate; // ageing fallback only
      return {
        orderId: cleanStr(r[oCols.id]),
        customerName: cleanStr(r[oCols.customer]),
        customerKey: normName(r[oCols.customer]),
        mobile: cleanStr(r[oCols.mobile]),
        sae: cleanStr(r[oCols.sae]) || "Unassigned",
        orderDate,
        deliveryDate,
        billDate, // the date the bill "ages" from
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
      // Use Final Qty as the source of truth. Fall back to Qty only when
      // Final Qty is blank; a legitimate numeric zero must remain zero.
      const finalQtyCell = cleanStr(r[olCols.finalQty]);
      const finalQty = finalQtyCell === "" ? toNumber(r[olCols.qty]) : toNumber(finalQtyCell);
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
        finalQty,
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
      // Use the Payments sheet's explicit Date column for the slicer, charts,
      // display, and payment allocation. Timestamp is entry/modify time,
      // not the business date of the payment.
      date: parseFlexibleDate(r[pCols.date]),
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
      // Stock Return date filters and reporting use the Stock Return sheet's Date column.
      date: parseFlexibleDate(r[srCols.date]),
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

    // Advance/surplus for this customer: credits that overflowed past every known bill
    const surplus = custCredits.reduce((s, c) => s + (c.unappliedOverflow || 0), 0);

    custBills.forEach(b => {
      const paidAmt = b.allocations.filter(a => a.type === "payment").reduce((s, a) => s + a.appliedAmount, 0);
      const returnedAmt = b.allocations.filter(a => a.type === "return").reduce((s, a) => s + a.appliedAmount, 0);
      const pending = Math.max(0, +b.remaining.toFixed(2));
      const adjustments = +(paidAmt + returnedAmt).toFixed(2);
      // Credits are processed chronologically. The settlement date is the date
      // of the allocation that finally clears this order; for outstanding orders
      // it remains blank and ageing is measured through today.
      const lastAllocDate = b.allocations.length ? b.allocations.reduce((m, a) => (a.date > m ? a.date : m), b.allocations[0].date) : null;
      const settlementDate = pending <= 0.5 ? (lastAllocDate || b.billDate) : null;
      const ageingDays = settlementDate ? Math.max(0, daysBetween(b.billDate, settlementDate)) : Math.max(0, daysAgo(b.billDate));
      const ageDays = pending > 0.5 ? daysAgo(b.billDate) : null;
      let status = "Outstanding";
      if (pending <= 0.5) status = "Settled";
      else if (adjustments > 0.5) status = "Partially Settled";

      // CREDIT vs PAID SALE — decided once, at the time of the order, and never
      // revisited: if same-day payments already covered the full bill value on
      // the day it was raised, it was a cash/paid sale; otherwise it was sold
      // on credit, regardless of whether it gets fully paid off later.
      const sameDayPaid = b.allocations
        .filter(a => a.type === "payment" && isSameDay(a.date, b.billDate))
        .reduce((s, a) => s + a.appliedAmount, 0);
      const saleType = (b.orderValue <= 0.5 || sameDayPaid >= b.orderValue - 0.5) ? "Paid Sale" : "Credit Sale";

      bills.push({
        orderId: b.orderId,
        customerName: b.customerName,
        customerKey: b.customerKey,
        sae: b.sae,
        deliveryDate: b.deliveryDate,
        billDate: b.billDate,
        deliveryMode: b.deliveryMode,
        deliveryStatus: b.deliveryStatus,
        isDelivered: normName(b.deliveryStatus) === "DELIVERED",
        approvalStatus: b.approvalStatus,
        verificationStatus: b.verificationStatus,
        productionStatus: b.productionStatus,
        quotationNo: b.quotationNo,
        billValue: +b.orderValue.toFixed(2),
        paidAmount: +paidAmt.toFixed(2),
        returnedAmount: +returnedAmt.toFixed(2),
        adjustments,
        pendingBalance: pending,
        balance: pending,
        ageDays,
        ageingDays,
        settlementStatus: status,
        settlementDate,
        status,
        billType: b.saleType === "Paid Sale" ? "Paid" : "Credit",
        saleType,
        customerSurplus: +surplus.toFixed(2),
        lastAllocationDate: lastAllocDate
      });
    });
  });

  // ---------- ANNOTATE ORDER LINES with parent bill's saleType / delivered flag ----------
  const billByOrderId = {};
  bills.forEach(b => { billByOrderId[b.orderId] = b; });
  orderLines.forEach(l => {
    const parentBill = billByOrderId[l.orderUid];
    l.saleType = parentBill ? parentBill.saleType : "Credit Sale";
    l.isDelivered = parentBill ? parentBill.isDelivered : false;
    l.deliveryStatus = parentBill ? parentBill.deliveryStatus : "Unknown";
  });

  // ---------- CUSTOMER SUMMARY (built from bills, so numbers tie to the ledger) ----------
  const customerSummaryMap = {};
  const ensureCustomer = (key, name) => (customerSummaryMap[key] = customerSummaryMap[key] || {
    customerName: name || key, customerKey: key, totalBilled: 0, totalPaid: 0, totalReturned: 0,
    billCount: 0, pendingBillCount: 0, creditBillCount: 0, paidSaleBillCount: 0,
    oldestPendingAge: null, saeSet: new Set(), lastPaymentDate: null
  });
  bills.forEach(b => {
    if (!b.customerKey) return;
    const c = ensureCustomer(b.customerKey, b.customerName);
    c.totalBilled += b.billValue; c.billCount += 1; c.saeSet.add(b.sae);
    if (b.saleType === "Credit Sale") c.creditBillCount += 1; else c.paidSaleBillCount += 1;
    if (b.pendingBalance > 0.5) {
      c.pendingBillCount += 1;
      if (c.oldestPendingAge === null || (b.ageDays !== null && b.ageDays > c.oldestPendingAge)) c.oldestPendingAge = b.ageDays;
    }
  });
  payments.forEach(p => {
    const c = ensureCustomer(p.customerKey, p.customerName);
    c.totalPaid += p.amount;
    if (!c.lastPaymentDate || p.date > c.lastPaymentDate) c.lastPaymentDate = p.date;
    if (p.sae) c.saeSet.add(p.sae);
  });
  stockReturns.forEach(r => {
    const c = ensureCustomer(r.customerKey, r.customerName);
    c.totalReturned += r.amount;
    if (r.sae) c.saeSet.add(r.sae);
  });
  const customerSummaries = Object.values(customerSummaryMap).map(c => {
    const netOutstanding = +(c.totalBilled - c.totalPaid - c.totalReturned).toFixed(2);
    const outstandingExcludingSurplus = Math.max(0, netOutstanding);
    const surplus = Math.max(0, -netOutstanding);
    return {
      ...c,
      totalBilled: +c.totalBilled.toFixed(2), totalPaid: +c.totalPaid.toFixed(2), totalReturned: +c.totalReturned.toFixed(2),
      outstandingExcludingSurplus: +outstandingExcludingSurplus.toFixed(2),
      outstandingIncludingSurplus: netOutstanding, surplus: +surplus.toFixed(2), netOutstanding,
      saeList: Array.from(c.saeSet)
    };
  });
  const customerSurplusMap = {};
  customerSummaries.forEach(c => { customerSurplusMap[c.customerKey] = c.surplus; });

  // ---------- PRODUCT ROLLUP (dimension/color/design agnostic) ----------
  // "Sold" = Delivered orders only, per business definition; everything else
  // (approved/verified/production-completed but not yet delivered) counts as
  // "in progress" and is tracked separately, never mixed into sales figures.
  const productMap = {};
  orderLines.forEach(l => {
    const key = normName(l.productName);
    const p = (productMap[key] = productMap[key] || {
      productName: l.productName, qtySold: 0, amountSold: 0, orderCount: 0,
      qtyInProgress: 0, amountInProgress: 0, orderCountInProgress: 0, variantSet: new Set()
    });
    if (l.isDelivered) {
      p.qtySold += l.finalQty;
      p.amountSold += l.amount;
      p.orderCount += 1;
    } else {
      p.qtyInProgress += l.finalQty;
      p.amountInProgress += l.amount;
      p.orderCountInProgress += 1;
    }
    if (l.dimensions || l.majorColor || l.designs) p.variantSet.add([l.dimensions, l.majorColor, l.minorColor, l.designs].filter(Boolean).join(" / "));
  });
  stockReturns.forEach(s => {
    const key = normName(s.productName);
    const p = (productMap[key] = productMap[key] || {
      productName: s.productName, qtySold: 0, amountSold: 0, orderCount: 0,
      qtyInProgress: 0, amountInProgress: 0, orderCountInProgress: 0, variantSet: new Set()
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

  // ---------- SAE-WISE SALES (Delivered only) ----------
  const saeSalesMap = {};
  bills.filter(b => b.isDelivered).forEach(b => {
    const s = (saeSalesMap[b.sae] = saeSalesMap[b.sae] || { sae: b.sae, salesValue: 0, orderCount: 0, qty: 0 });
    s.salesValue += b.billValue; s.orderCount += 1;
  });
  orderLines.filter(l => l.isDelivered).forEach(l => {
    const s = saeSalesMap[l.sae];
    if (s) s.qty += l.finalQty;
  });
  const saeSalesRollup = Object.values(saeSalesMap).sort((a, b) => b.salesValue - a.salesValue);

  // ---------- FILTER OPTION LISTS ----------
  const saeList = Array.from(new Set([
    ...orders.map(o => o.sae), ...payments.map(p => p.sae), ...stockReturns.map(s => s.sae)
  ].filter(Boolean))).sort();
  const deliveryModeList = Array.from(new Set(orders.map(o => o.deliveryMode).filter(Boolean))).sort();
  const deliveryStatusList = Array.from(new Set(orders.map(o => o.deliveryStatus).filter(Boolean))).sort();
  const paymentViaList = Array.from(new Set(payments.map(p => p.via).filter(Boolean))).sort();
  const customerNameList = Array.from(allCustomerKeys).map(k => canonicalName[k] || (billsByCustomer[k] && billsByCustomer[k][0].customerName) || k).sort();

  const dimensionList = Array.from(new Set(orderLines.map(l => l.dimensions).filter(Boolean))).sort();
  const subTypeList = Array.from(new Set(orderLines.map(l => l.subType).filter(Boolean))).sort();
  const designList = Array.from(new Set(orderLines.map(l => l.designs).filter(Boolean))).sort();
  const majorColorList = Array.from(new Set(orderLines.map(l => l.majorColor).filter(Boolean))).sort();
  const minorColorList = Array.from(new Set(orderLines.map(l => l.minorColor).filter(Boolean))).sort();
  const productNameList = Array.from(new Set(orderLines.map(l => l.productName).filter(Boolean))).sort();

  return {
    orders, orderLines, payments, stockReturns,
    bills, customerSummaries, productRollup, saeSalesRollup, customerSurplusMap,
    saeList, deliveryModeList, deliveryStatusList, paymentViaList, customerNameList,
    dimensionList, subTypeList, designList, majorColorList, minorColorList, productNameList,
    generatedAt: new Date()
  };
}
