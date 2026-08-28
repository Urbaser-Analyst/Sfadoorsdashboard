/* =====================================================================
   DATE UTILS — Google Sheets' gviz CSV export renders dates using the
   cell's own display format, which varies (dd-MMM-yyyy, dd/mm/yyyy,
   yyyy-mm-dd, or a full timestamp). This parses all of those robustly.
   ===================================================================== */

const MONTHS = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11
};

function parseFlexibleDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  let s = String(value).trim();
  if (!s) return null;

  // Google Charts literal: Date(2026,7,15,11,26,40)  (month is 0-indexed)
  let m = s.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+))?(?:,(\d+))?(?:,(\d+))?\)$/);
  if (m) {
    return new Date(+m[1], +m[2], +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }

  // dd-MMM-yyyy or dd-MMM-yy  (e.g. 30-Mar-2024)
  m = s.match(/^(\d{1,2})[-\s](\w{3,})[-\s](\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0,3).toLowerCase()];
    if (mon !== undefined) {
      let yr = +m[3]; if (yr < 100) yr += 2000;
      return new Date(yr, mon, +m[1]);
    }
  }

  // dd/mm/yyyy or dd-mm-yyyy (day-first, common in IN locale) with optional time
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    let yr = +m[3]; if (yr < 100) yr += 2000;
    const day = +m[1], mon = +m[2] - 1;
    // Guard against ambiguous mm/dd inputs: if "month" > 12 swap
    if (mon > 11) {
      return new Date(yr, day - 1, mon + 1, +(m[4]||0), +(m[5]||0), +(m[6]||0));
    }
    return new Date(yr, mon, day, +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }

  // yyyy-mm-dd (ISO) with optional time
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return new Date(+m[1], +m[2]-1, +m[3], +(m[4]||0), +(m[5]||0), +(m[6]||0));
  }

  // Excel serial number (rare via CSV, but guard anyway)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) {
      const epoch = new Date(1899, 11, 30);
      return new Date(epoch.getTime() + serial * 86400000);
    }
  }

  // Fallback to native parser
  const native = new Date(s);
  return isNaN(native) ? null : native;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = b.setHours(0,0,0,0) - a.setHours(0,0,0,0);
  return Math.round(ms / 86400000);
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function daysAgo(date) {
  if (!date) return null;
  return daysBetween(new Date(date), new Date());
}

function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}

function toISODate(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0,10);
}

function monthKey(date) {
  const d = new Date(date);
  if (isNaN(d)) return "Unknown";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function monthLabel(key) {
  const [y,m] = key.split("-");
  const d = new Date(+y, +m-1, 1);
  return d.toLocaleDateString("en-IN", { month:"short", year:"2-digit" });
}
