/* =====================================================================
   AUTH — simple client-side password gate with a 24h session.

   IMPORTANT (please read): this is a *static* GitHub Pages site with
   no server, so this cannot be real security — anyone who views the
   page source, or knows the password, can get in, and a determined
   person could bypass the check entirely in devtools. Treat this as a
   speed bump against casual access (and against the sheet's own
   "anyone with the link" sharing), not as protection for sensitive
   data. If you need real access control, put this behind a proper
   authenticated backend instead.
   ===================================================================== */

const AUTH_KEY = "sfa_dashboard_session_v1";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.expiry || Date.now() > session.expiry) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return session;
  } catch (e) {
    return null;
  }
}

function startSession() {
  const session = { expiry: Date.now() + CONFIG.SESSION_LENGTH_MS };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

function endSession() {
  localStorage.removeItem(AUTH_KEY);
}

function isLoggedIn() {
  return !!getSession();
}

function initAuth(onSuccess) {
  const loginScreen = document.getElementById("loginScreen");
  const appEl = document.getElementById("app");
  const form = document.getElementById("loginForm");
  const pwInput = document.getElementById("pwInput");
  const errorEl = document.getElementById("loginError");
  const logoutBtn = document.getElementById("logoutBtn");

  function showApp() {
    loginScreen.hidden = true;
    appEl.hidden = false;
    onSuccess();
  }

  if (isLoggedIn()) {
    showApp();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const entered = pwInput.value;
    const hash = await sha256Hex(entered);
    if (hash === CONFIG.PASSWORD_HASH) {
      errorEl.hidden = true;
      startSession();
      showApp();
    } else {
      errorEl.hidden = false;
      pwInput.value = "";
      pwInput.focus();
    }
  });

  logoutBtn.addEventListener("click", () => {
    endSession();
    location.reload();
  });

  // Periodically check session expiry while the tab stays open
  setInterval(() => {
    if (!isLoggedIn() && !appEl.hidden) {
      location.reload();
    }
  }, 60 * 1000);
}
