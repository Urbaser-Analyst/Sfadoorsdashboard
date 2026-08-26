/* =====================================================================
   DATA — fetches each tab as CSV from the published Google Sheet and
   parses it with PapaParse. Column lookup is done by fuzzy header
   matching so small naming variations in the sheet don't break things.
   ===================================================================== */

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a {normalizedHeader: originalHeader} map for one parsed row-set
function headerMap(fields) {
  const map = {};
  fields.forEach(f => { map[normalizeHeader(f)] = f; });
  return map;
}

// Find the first matching original header for a list of candidate names
function pick(map, ...candidates) {
  for (const c of candidates) {
    const key = normalizeHeader(c);
    if (map[key] !== undefined) return map[key];
  }
  return null;
}

async function fetchCsv(tabName) {
  const url = buildSheetCsvUrl(tabName);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not load tab "${tabName}" (HTTP ${res.status}). Check the tab name and that the sheet is shared as "Anyone with the link – Viewer".`);
  }
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`Tab "${tabName}" returned a login page instead of data. Make sure the Google Sheet is shared as "Anyone with the link – Viewer".`);
  }
  const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return { fields: parsed.meta.fields || [], rows: parsed.data };
}

async function loadAllSheets() {
  const [order, orderList, payments, stockReturn, customerMaster] = await Promise.all([
    fetchCsv(CONFIG.TABS.order),
    fetchCsv(CONFIG.TABS.orderList),
    fetchCsv(CONFIG.TABS.payments),
    fetchCsv(CONFIG.TABS.stockReturn),
    fetchCsv(CONFIG.TABS.customerMaster).catch(() => ({ fields: [], rows: [] })) // optional tab
  ]);
  return { order, orderList, payments, stockReturn, customerMaster };
}
