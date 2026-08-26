/* =====================================================================
   CHARTS — thin wrappers around Chart.js so views can create/replace
   charts without repeating boilerplate. Instances are tracked by
   canvas id so re-rendering a view destroys the old chart first.
   ===================================================================== */

const CHART_PALETTE = ["#3E7C74", "#C98A2C", "#B5573C", "#2E524F", "#8FAE7A", "#D9A441", "#6E8B87", "#A7714D"];
const chartInstances = {};

Chart.defaults.font.family = "'Manrope', system-ui, sans-serif";
Chart.defaults.color = "#5C6357";
Chart.defaults.borderColor = "#E6E1D6";

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

function fmtINR(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 10000000) return (n / 10000000).toFixed(2) + " Cr";
  if (abs >= 100000) return (n / 100000).toFixed(2) + " L";
  if (abs >= 1000) return (n / 1000).toFixed(1) + " K";
  return n.toFixed(0);
}
function fmtRupee(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function makeLineChart(canvasId, labels, datasets, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: datasets.map((d, i) => ({
      tension: 0.35, borderWidth: 2.5, pointRadius: 2, fill: opts.fill || false,
      borderColor: CHART_PALETTE[i % CHART_PALETTE.length],
      backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] + "22",
      ...d
    })) },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: datasets.length > 1, position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtINR(v) }, grid: { color: "#EFECE3" } },
        x: { grid: { display: false } }
      },
      ...opts.options
    }
  });
}

function makeBarChart(canvasId, labels, datasets, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: datasets.map((d, i) => ({
      borderRadius: 5, maxBarThickness: 38,
      backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
      ...d
    })) },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: opts.horizontal ? "y" : "x",
      plugins: { legend: { display: datasets.length > 1, position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
      scales: {
        x: { beginAtZero: true, grid: { display: opts.horizontal }, ticks: opts.horizontal ? { callback: v => fmtINR(v) } : {} },
        y: { beginAtZero: true, grid: { display: !opts.horizontal, color: "#EFECE3" }, ticks: !opts.horizontal ? { callback: v => fmtINR(v) } : {} }
      },
      ...opts.options
    }
  });
}

function makeDoughnut(canvasId, labels, data, opts = {}) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data, backgroundColor: CHART_PALETTE, borderWidth: 2, borderColor: "#fff" }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: { legend: { position: "right", labels: { boxWidth: 10, usePointStyle: true, font: { size: 11 } } } },
      ...opts.options
    },
    onClick: opts.onClick
  });
  if (opts.onClick) {
    document.getElementById(canvasId).onclick = (evt) => {
      const points = chartInstances[canvasId].getElementsAtEventForMode(evt, "nearest", { intersect: true }, true);
      if (points.length) opts.onClick(points[0].index);
    };
  }
}
