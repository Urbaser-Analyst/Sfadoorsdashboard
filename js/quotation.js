/* =====================================================================
   QUOTATION / BILL GENERATOR
   - Pick a Customer, then one of that customer's DELIVERED orders — both
     are real searchable dropdowns (not a native <input list>, which has
     no suggestion UI at all on iOS/Safari and needs an exact text match
     to register a pick — that's what made this feel broken before).
   - Order lines are grouped by "Bill Name" (the customer-facing item name),
     summing Final Qty and Amount per group — matching how the company's
     paper quotations are actually written up.
   - Transport / Packing / Loading / Other charges come from the Orders
     sheet and are added under the items subtotal.
   - A small checkpoint box compares the Orders-sheet Order Value against
     the computed quotation total, flagging any mismatch.
   - "Print / Save as PDF" uses the browser's native print dialog (every
     browser's print dialog offers "Save as PDF"), so it needs no external
     library or internet connection. A "Download as Image PDF" button is
     also offered when jsPDF/html2canvas happen to be available, as an
     alternate one-click file — but printing is the reliable default.
   ===================================================================== */

const quotationState = { customerKey: "", orderUid: "" };

function quotationDeliveredBillsByCustomer(DB) {
  const map = {};
  DB.bills.filter(b => b.isDelivered).forEach(b => {
    (map[b.customerKey] = map[b.customerKey] || []).push(b);
  });
  Object.values(map).forEach(list => list.sort((a, b) => (b.deliveryDate || b.billDate || 0) - (a.deliveryDate || a.billDate || 0)));
  return map;
}

// Group an order's lines the way the paper quotation groups them: by Bill
// Name (falls back to Product Name if Bill Name is blank), summing Final Qty
// and Amount, with Price/Unit recomputed as Amount ÷ Qty for that group.
function buildQuotationItems(orderLines) {
  const map = {};
  orderLines.forEach(l => {
    const key = l.billName || l.productName;
    const item = (map[key] = map[key] || { itemName: key, qty: 0, amount: 0 });
    item.qty += l.finalQty;
    item.amount += l.amount;
  });
  return Object.values(map).map(item => ({
    ...item,
    rate: item.qty > 0 ? item.amount / item.qty : 0
  }));
}

function renderQuotation(DB, f) {
  try {
    renderQuotationUnsafe(DB, f);
  } catch (err) {
    console.error("Quotation tab failed to render:", err);
    document.getElementById("viewRoot").innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Quotation / Bill Generator</div></div>
        <p class="small-note" style="color:#C0392B">Something went wrong building this tab: ${(err && err.message) || err}. Please use the thumbs-down button to report this, or try Refresh.</p>
      </div>`;
  }
}

function renderQuotationUnsafe(DB, f) {
  const billsByCustomer = quotationDeliveredBillsByCustomer(DB);
  const customerOptions = Object.keys(billsByCustomer)
    .map(key => ({ key, name: billsByCustomer[key][0].customerName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!quotationState.customerKey && customerOptions.length) quotationState.customerKey = customerOptions[0].key;
  if (quotationState.customerKey && !billsByCustomer[quotationState.customerKey]) { quotationState.customerKey = customerOptions[0]?.key || ""; quotationState.orderUid = ""; }
  const ordersForCustomer = quotationState.customerKey ? (billsByCustomer[quotationState.customerKey] || []) : [];
  if (!quotationState.orderUid && ordersForCustomer.length) quotationState.orderUid = ordersForCustomer[0].orderId;
  if (quotationState.orderUid && !ordersForCustomer.some(o => o.orderId === quotationState.orderUid)) quotationState.orderUid = ordersForCustomer[0]?.orderId || "";

  document.getElementById("viewRoot").innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Generate a Quotation / Bill</div>
        <div class="panel-note">Pick a customer, then one of their delivered orders. The template below fills in automatically, in the company's standard format.</div>
      </div>
      <div class="inline-filterbar">
        ${singleSelectHtml("qCustomer", "Customer Name", "Select a customer…")}
        ${singleSelectHtml("qOrder", "Delivered Order", "Select an order…")}
      </div>
      ${customerOptions.length === 0 ? `<p class="small-note" style="margin-top:10px">No delivered orders were found in the current global filters/date range. Widen the date range or clear filters to generate a quotation.</p>` : ""}
    </div>
    <div id="quotationBody"></div>
  `;

  const customerDropdownOptions = customerOptions.map(c => ({ value: c.key, label: c.name }));
  singleSelectWire("qCustomer",
    () => customerDropdownOptions,
    () => quotationState.customerKey,
    (value) => {
      quotationState.customerKey = value;
      quotationState.orderUid = "";
      renderQuotation(DB, f);
    },
    "Select a customer…"
  );

  const orderDropdownOptions = ordersForCustomer.map(o => ({ value: o.orderId, label: `${o.orderId} — ${formatDate(o.deliveryDate || o.billDate)} — ${fmtRupee(o.billValue)}` }));
  singleSelectWire("qOrder",
    () => orderDropdownOptions,
    () => quotationState.orderUid,
    (value) => {
      quotationState.orderUid = value;
      renderQuotationBody(DB);
    },
    "Select an order…"
  );

  renderQuotationBody(DB);
}

function renderQuotationBody(DB) {
  try {
    renderQuotationBodyUnsafe(DB);
  } catch (err) {
    console.error("Quotation preview failed to render:", err);
    const container = document.getElementById("quotationBody");
    if (container) container.innerHTML = `<div class="panel"><p class="small-note" style="color:#C0392B">Couldn't build the quotation preview: ${(err && err.message) || err}.</p></div>`;
  }
}

function renderQuotationBodyUnsafe(DB) {
  const container = document.getElementById("quotationBody");
  if (!container) return;
  const bill = DB.bills.find(b => b.orderId === quotationState.orderUid && b.isDelivered);
  if (!bill) { container.innerHTML = ""; return; }

  const orderLines = DB.orderLines.filter(l => l.orderKey === bill.orderKey);
  const items = buildQuotationItems(orderLines).sort((a, b) => b.amount - a.amount);
  const totalQty = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const charges = [
    { label: "Transport Charges", value: bill.transportCharges },
    { label: "Packing Charges", value: bill.packingCharges },
    { label: "Loading Charges", value: bill.loadingCharges },
    { label: "Other Charges", value: bill.otherCharges }
  ];
  const chargesTotal = charges.reduce((s, c) => s + c.value, 0);
  const quotationTotal = +(subtotal + chargesTotal).toFixed(2);
  const orderValue = +bill.billValue.toFixed(2);
  const diff = +(quotationTotal - orderValue).toFixed(2);
  const matches = Math.abs(diff) < 0.5;

  const logo = getCompanyLogo();
  const quotationNo = bill.quotationNo || `Q-${bill.billId}`;
  const quotationDate = formatDate(bill.deliveryDate || bill.billDate);

  container.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Value Checkpoint</div>
        <div class="panel-note">Compares the Order Value recorded on the Orders sheet against the quotation total computed from this order's line items + charges.</div>
      </div>
      <div class="checkpoint-row">
        <div class="checkpoint-box"><div class="checkpoint-label">Order Value (Orders sheet)</div><div class="checkpoint-value">${fmtRupee(orderValue)}</div></div>
        <div class="checkpoint-box"><div class="checkpoint-label">Quotation Value (computed)</div><div class="checkpoint-value">${fmtRupee(quotationTotal)}</div></div>
        <div class="checkpoint-box checkpoint-status ${matches ? "checkpoint-ok" : "checkpoint-mismatch"}">
          <div class="checkpoint-label">${matches ? "✓ Values match" : "✗ Mismatch"}</div>
          <div class="checkpoint-value">${matches ? "No action needed" : `${diff > 0 ? "+" : ""}${fmtRupee(diff)} difference`}</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">Quotation Preview</div>
        <div class="panel-note">This is exactly what will be exported to PDF.</div>
      </div>
      <div class="table-toolbar" style="margin-bottom:12px">
        <div class="table-toolbar-left"></div>
        <button type="button" class="btn table-export-btn" id="qPrintBtn">Print / Save as PDF</button>
        <button type="button" class="btn btn-outline table-export-btn" id="qDownloadPdfBtn" style="display:none">Download as Image PDF</button>
      </div>
      <div class="quotation-scroll">
        <div class="quotation-sheet" id="quotationSheet">
          <div class="q-header">
            <div class="q-header-left">
              ${logo ? `<img src="${logo}" class="q-logo" alt="${(typeof CONFIG !== "undefined" ? CONFIG.COMPANY_NAME : "Company")} logo">` : `<div class="q-logo-fallback">${((typeof CONFIG !== "undefined" ? CONFIG.COMPANY_NAME : "SFA") || "SFA").split(" ").map(w => w[0]).join("").slice(0, 3)}</div>`}
              <div>
                <div class="q-company-name">${CONFIG.COMPANY_NAME}</div>
                <div class="q-company-line">${CONFIG.COMPANY_ADDRESS_LINE1}</div>
                <div class="q-company-line">${CONFIG.COMPANY_ADDRESS_LINE2}</div>
                <div class="q-company-line">Phone: ${CONFIG.COMPANY_PHONE}</div>
                <div class="q-company-line">Email: ${CONFIG.COMPANY_EMAIL}</div>
                <div class="q-company-line">GSTIN: ${CONFIG.COMPANY_GSTIN}</div>
              </div>
            </div>
            <div class="q-header-right">
              <div class="q-doc-title">QUOTATION</div>
              <table class="q-meta-table">
                <tr><td>Date</td><td>${quotationDate}</td></tr>
                <tr><td>Quotation No.</td><td>${quotationNo}</td></tr>
                <tr><td>Bill No.</td><td>${bill.billId}</td></tr>
                <tr><td>Order ID</td><td>${bill.orderId}</td></tr>
              </table>
            </div>
          </div>

          <div class="q-to">
            <div class="q-to-label">TO</div>
            <div class="q-to-name">${bill.customerName}</div>
            ${bill.mobile ? `<div class="q-to-line">Ph: ${bill.mobile}</div>` : ""}
          </div>

          <table class="q-items-table">
            <thead>
              <tr><th style="width:36px">#</th><th>Item Name</th><th style="width:110px">Price/Unit</th><th style="width:70px">Qty</th><th style="width:110px">Amount</th></tr>
            </thead>
            <tbody>
              ${items.map((item, i) => `<tr>
                <td>${i + 1}</td><td>${item.itemName}</td>
                <td class="num">${fmtRupee(item.rate)}</td>
                <td class="num">${item.qty.toLocaleString("en-IN")}</td>
                <td class="num">${fmtRupee(item.amount)}</td>
              </tr>`).join("") || `<tr><td colspan="5" class="empty-note">No rows in the Order List sheet have "Order UID" = ${bill.orderId} (order ID from the Orders sheet). Check the Order List sheet for that order's product rows.</td></tr>`}
            </tbody>
          </table>

          <div class="q-totals-block">
            <div class="q-totals-left">
              <div class="q-total-qty">Total Qty: <strong>${totalQty.toLocaleString("en-IN")}</strong></div>
              <div class="q-notes">Notes: Goods once sold will only be taken back or exchanged as per company policy.</div>
            </div>
            <table class="q-totals-table">
              <tr><td>Subtotal</td><td class="num">${fmtRupee(subtotal)}</td></tr>
              ${charges.map(c => `<tr><td>${c.label}</td><td class="num">${c.value > 0 ? fmtRupee(c.value) : "—"}</td></tr>`).join("")}
              <tr class="q-grand-total"><td>Total</td><td class="num">${fmtRupee(quotationTotal)}</td></tr>
            </table>
          </div>

          <div class="q-bank-block">
            <div class="q-bank-title">Company's Bank details:</div>
            <div class="q-bank-line">Account Name: ${CONFIG.COMPANY_BANK_ACCOUNT_NAME}</div>
            <div class="q-bank-line">Bank Account No.: ${CONFIG.COMPANY_BANK_ACCOUNT_NO}</div>
            <div class="q-bank-line">Bank Name: ${CONFIG.COMPANY_BANK_NAME}</div>
            <div class="q-bank-line">Bank IFSC code: ${CONFIG.COMPANY_BANK_IFSC}</div>
            <div class="q-bank-line">GPay Number: ${CONFIG.COMPANY_GPAY_NUMBER}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("qPrintBtn").addEventListener("click", () => printQuotation());

  // "Download as Image PDF" is a bonus one-click file when jsPDF/html2canvas
  // successfully loaded from the CDN — never required, since Print always works.
  const pdfBtn = document.getElementById("qDownloadPdfBtn");
  if (pdfBtn && typeof html2canvas !== "undefined" && window.jspdf) {
    pdfBtn.style.display = "";
    pdfBtn.addEventListener("click", () => {
      downloadQuotationPdf(`Quotation_${bill.customerName}_${bill.orderId}`.replace(/[^a-z0-9_-]+/gi, "_"));
    });
  }
}

// Opens the browser's native print dialog, showing ONLY the quotation sheet
// (see the @media print rules in style.css). Works fully offline, on any
// browser/device, and "Save as PDF" is a standard destination in every
// print dialog — this is the primary, dependency-free "generate a PDF" path.
function printQuotation() {
  window.print();
}

// Snapshots the on-screen #quotationSheet node and saves it as an A4 PDF,
// paginating automatically if the content is taller than one page.
function downloadQuotationPdf(fileName) {
  const node = document.getElementById("quotationSheet");
  if (!node || typeof html2canvas === "undefined" || !window.jspdf) {
    alert("PDF export libraries did not load — check your internet connection and try again.");
    return;
  }
  const btn = document.getElementById("qDownloadPdfBtn");
  const originalLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Preparing PDF…"; }

  html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" }).then(canvas => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      // Slice the tall canvas into page-height chunks so nothing gets cut mid-row.
      const pageCanvas = document.createElement("canvas");
      const pageCtx = pageCanvas.getContext("2d");
      const pxPerPage = Math.floor((canvas.width * pageHeight) / imgWidth);
      pageCanvas.width = canvas.width;
      let renderedHeight = 0, first = true;
      while (renderedHeight < canvas.height) {
        const sliceHeight = Math.min(pxPerPage, canvas.height - renderedHeight);
        pageCanvas.height = sliceHeight;
        pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageCtx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
        const sliceImgHeight = (sliceHeight * imgWidth) / canvas.width;
        if (!first) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, sliceImgHeight);
        renderedHeight += sliceHeight;
        first = false;
      }
    }
    pdf.save(`${fileName || "quotation"}.pdf`);
  }).catch(err => {
    console.error(err);
    alert("Could not generate the PDF. Please try again.");
  }).finally(() => {
    if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
  });
}
