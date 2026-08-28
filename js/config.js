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
  PASSWORD_HASH: "12cca7afe45b516d0b0ed5226678999924641f918f8ce37c4b40ee29004502e5" // password: sfa@123
};

function buildSheetCsvUrl(tabName) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&cachebust=${Date.now()}`;
}
