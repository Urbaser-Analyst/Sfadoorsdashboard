/* =====================================================================
   CONFIG — edit these values for your deployment.
   ===================================================================== */

const CONFIG = {
  // The long ID from your Google Sheet URL:
  // https://docs.google.com/spreadsheets/d/  <THIS PART>  /edit
  SHEET_ID: "1BUgdmL49ECzVKCJ_My28mVY7W58k-gpmsDaB5_uxbMw",

  // Exact tab (sheet) names to pull. Must match your Google Sheet tabs exactly.
  TABS: {
    order:        "Order",
    orderList:    "Order List",
    payments:     "Payments",
    stockReturn:  "Stock Return",
    customerMaster: "Customer Master"
  },

  // Auto-refresh interval when the toggle is on (milliseconds)
  AUTO_REFRESH_MS: 5 * 60 * 1000,

  // Session length for the login gate (milliseconds)
  SESSION_LENGTH_MS: 24 * 60 * 60 * 1000,

  // SHA-256 hash of the dashboard password (never store the plain password here).
  // Default password is "sfa2026" — CHANGE THIS before you deploy.
  // To generate a new hash: open browser console anywhere and run
  //   crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourNewPassword'))
  //     .then(b => console.log(Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,'0')).join('')))
  // then paste the result below.
  PASSWORD_HASH: "12cca7afe45b516d0b0ed5226678999924641f918f8ce37c4b40ee29004502e5", // password: sfa@123

  // ---- Company / branding — used across the dashboard AND the generated
  // Quotation PDF, so edit these here once instead of in multiple places.
  COMPANY_NAME: "SFA DOORS & PLYWOOD",
  COMPANY_ADDRESS_LINE1: "N.S.P COMPOUND 137/2 GANAPATHY NAGAR",
  COMPANY_ADDRESS_LINE2: "ARIYAMANGALAM, TRICHY-620010",
  COMPANY_PHONE: "6384402221, 7540025817",
  COMPANY_EMAIL: "sfadoortrichy@gmail.com",
  COMPANY_GSTIN: "33IHDPS9652A3Z5",
  COMPANY_BANK_ACCOUNT_NAME: "SFA DOORS AND PLYWOOD",
  COMPANY_BANK_ACCOUNT_NO: "1196135000012511",
  COMPANY_BANK_NAME: "KARUR VYSYA BANK, TIRUCHIRAPALLI CANTONMENT",
  COMPANY_BANK_IFSC: "KVBL0001196",
  COMPANY_GPAY_NUMBER: "7540025817",

  // Default logo shown in the header and on the Quotation PDF. This is only
  // the starting point — use the "Change Logo" control in the app header to
  // upload a different logo; that choice is saved in the browser and takes
  // over everywhere the logo appears (header + Quotation PDF), including
  // after you refresh the page or reopen the dashboard later.
  DEFAULT_LOGO_URL: ""
};

// The logo actually in use: an uploaded logo (saved in this browser via
// setCompanyLogo()) takes priority over CONFIG.DEFAULT_LOGO_URL, so changing
// the logo once immediately reflects everywhere it's used, including the
// Quotation PDF, without editing this file.
function getCompanyLogo() {
  try {
    const stored = window.localStorage.getItem("sfa_company_logo");
    if (stored) return stored;
  } catch (e) { /* localStorage unavailable — fall back to the default */ }
  return CONFIG.DEFAULT_LOGO_URL || "";
}
function setCompanyLogo(dataUrl) {
  try { window.localStorage.setItem("sfa_company_logo", dataUrl); } catch (e) { /* ignore */ }
}
function clearCompanyLogo() {
  try { window.localStorage.removeItem("sfa_company_logo"); } catch (e) { /* ignore */ }
}

function buildSheetCsvUrl(tabName) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&cachebust=${Date.now()}`;
}
