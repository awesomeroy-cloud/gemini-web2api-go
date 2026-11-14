// Auto-generated from web/src/app.ts via `bun run web/build.ts`. Do not edit directly.
import { mountOverview } from "./views-overview.js";
import { mountTraffic } from "./views-traffic.js";
import { mountAccounts } from "./views-accounts.js";
import { mountEgress } from "./views-egress.js";
import { mountModels } from "./views-models.js";
import { mountConfig } from "./views-config.js";
import { apiFetch, errMessage, isApiError, rootFetch, setUnauthorizedHandler } from "./api.js";
import { applyI18n, getLang, setLang, t } from "./i18n.js";
import { setAlert, toast, wireDialogLightDismiss } from "./ui.js";
const VIEW_MOUNTS = {
  overview: mountOverview,
  traffic: mountTraffic,
  accounts: mountAccounts,
  egress: mountEgress,
  models: mountModels,
  config: mountConfig
};
const VALID_VIEWS = ["overview", "traffic", "accounts", "egress", "models", "config"];
function isViewName(val) {
  return val != null && VALID_VIEWS.includes(val);
}
const instances = {};
let currentView = "overview";
let adminAuthRequired = false;
let authBlocked = false;
const colorMeta = document.querySelector('meta[name="color-scheme"]');
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
const sidebarNav = document.getElementById("sidebarNav");
const btnMobileMenu = document.getElementById("btnMobileMenu");
const btnThemeToggle = document.getElementById("btnThemeToggle");
const btnLangToggle = document.getElementById("btnLangToggle");
const btnGlobalRefresh = document.getElementById("btnGlobalRefresh");
const btnQuickProbe = document.getElementById("btnQuickProbe");
const btnLogout = document.getElementById("btnLogout");
const quickSearchForm = document.getElementById("quickSearchForm");
const quickAuditSearch = document.getElementById("quickAuditSearch");
const headerHealthDot = document.getElementById("headerHealthDot");
const headerHealthText = document.getElementById("headerHealthText");
const navBadgeAccounts = document.getElementById("navBadgeAccounts");
const navBadgeProxies = document.getElementById("navBadgeProxies");
const sidebarVersion = document.getElementById("sidebarVersion");
const sidebarProtocolBadge = document.getElementById("sidebarProtocolBadge");
const sidebarAuthNote = document.getElementById("sidebarAuthNote");
const loginDialog = document.getElementById("loginDialog");
const loginForm = document.getElementById("loginForm");
const loginToken = document.getElementById("loginToken");
const loginError = document.getElementById("loginError");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
function getRenderedScheme() {
  const content = colorMeta?.content || "light dark";
  return content === "dark" || content === "light dark" && darkMQ.matches ? "dark" : "light";
}
function updateThemeUI() {
  if (!btnThemeToggle)
    return;
  const dark = getRenderedScheme() === "dark";
  const zh = getLang() === "zh";
  btnThemeToggle.textContent = dark ? zh ? "☾ 深色" : "☾ Dark" : zh ? "☀ 浅色" : "☀ Light";
  btnThemeToggle.setAttribute("aria-pressed", String(dark));
}
function toggleTheme() {
  if (!colorMeta)
    return;
  const target = getRenderedScheme() === "dark" ? "light" : "dark";
  const sysDark = darkMQ.matches;
  if (target === "dark" === sysDark) {
    try {
      localStorage.removeItem("color-scheme");
    } catch {}
    colorMeta.content = "light dark";
  } else {
    try {
      localStorage.setItem("color-scheme", target);
    } catch {}
    colorMeta.content = target;
  }
  updateThemeUI();
}
window.addEventListener("storage", (e) => {
  if (e.key === "color-scheme" && colorMeta) {
    colorMeta.content = e.newValue ?? "light dark";
    updateThemeUI();
  }
});
darkMQ.addEventListener("change", () => {
  updateThemeUI();
});
function closeMobileMenu() {
  if (!sidebarNav || !btnMobileMenu)
    return;
  sidebarNav.classList.remove("is-open");
  btnMobileMenu.setAttribute("aria-expanded", "false");
}
function toggleMobileMenu() {
  if (!sidebarNav || !btnMobileMenu)
    return;
  const open = sidebarNav.classList.toggle("is-open");
  btnMobileMenu.setAttribute("aria-expanded", String(open));
}
function formatPairBadge(val) {
  if (typeof val === "string")
    return val;
  if (val && typeof val === "object") {
    const active = val.active ?? val.enabled ?? 0;
    const total = val.total ?? 0;
    return `${active}/${total}`;
  }
  return null;
}
function updateShellCounts(counts = {}) {
  const acctText = counts.accounts != null ? formatPairBadge(counts.accounts) : counts.accountsEnabled != null && counts.accountsTotal != null ? `${counts.accountsEnabled}/${counts.accountsTotal}` : null;
  if (acctText != null && navBadgeAccounts) {
    navBadgeAccounts.textContent = acctText;
  }
  const proxyText = counts.proxies != null ? formatPairBadge(counts.proxies) : counts.proxiesActive != null && counts.proxiesTotal != null ? `${counts.proxiesActive}/${counts.proxiesTotal}` : null;
  if (proxyText != null && navBadgeProxies) {
    navBadgeProxies.textContent = proxyText;
  }
  if (counts.version) {
    if (headerHealthText)
      headerHealthText.textContent = `v${counts.version} · online`;
    if (headerHealthDot)
      headerHealthDot.className = "status-dot";
    if (sidebarVersion)
      sidebarVersion.textContent = `v${counts.version}`;
  }
  if (counts.protocol !== undefined && sidebarProtocolBadge) {
    sidebarProtocolBadge.textContent = typeof counts.protocol === "boolean" ? counts.protocol ? "WebChannel" : "StreamGenerate" : String(counts.protocol);
  }
}
function showLoginDialog() {
  authBlocked = true;
  if (btnLogout)
    btnLogout.hidden = true;
  if (!loginDialog)
    return;
  setAlert(loginError, "");
  if (!loginDialog.open) {
    loginDialog.showModal();
  }
  loginToken?.focus();
}
function clearMountedViews() {
  for (const view of VALID_VIEWS) {
    const sec = document.getElementById(`view-${view}`);
    if (sec)
      sec.innerHTML = "";
    delete instances[view];
  }
  if (navBadgeAccounts)
    navBadgeAccounts.textContent = "-";
  if (navBadgeProxies)
    navBadgeProxies.textContent = "-";
}
const ctx = {
  navigate,
  updateShellCounts
};
function navigate(viewName, opts = {}) {
  const view = isViewName(viewName) ? viewName : "overview";
  currentView = view;
  const targetHash = `#${view}`;
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
  for (const name of VALID_VIEWS) {
    const sec = document.getElementById(`view-${name}`);
    if (sec)
      sec.hidden = name !== view;
  }
  if (sidebarNav) {
    for (const btn of sidebarNav.querySelectorAll(".nav-btn[data-view]")) {
      if (btn.dataset.view === view) {
        btn.setAttribute("aria-current", "page");
      } else {
        btn.removeAttribute("aria-current");
      }
    }
  }
  closeMobileMenu();
  if (authBlocked)
    return;
  const panelEl = document.getElementById(`view-${view}`);
  if (!panelEl)
    return;
  const firstMount = !instances[view];
  if (firstMount) {
    instances[view] = VIEW_MOUNTS[view](panelEl, ctx);
    applyI18n(panelEl);
  }
  const inst = instances[view];
  if (view === "traffic" && opts.q !== undefined && inst?.setSearchQuery) {
    inst.setSearchQuery(opts.q);
  } else if (!firstMount || Object.keys(opts).length > 0) {
    inst?.refresh?.(opts);
  }
}
async function loadHealth() {
  try {
    const data = await rootFetch("");
    if (data?.version) {
      updateShellCounts({ version: data.version });
    } else if (headerHealthText) {
      headerHealthText.textContent = "online";
    }
    if (headerHealthDot)
      headerHealthDot.className = "status-dot";
  } catch {
    if (headerHealthDot)
      headerHealthDot.className = "status-dot status-dot--err";
    if (headerHealthText)
      headerHealthText.textContent = "offline";
  }
}
async function loadShellInfo() {
  const results = await Promise.allSettled([
    apiFetch("config"),
    apiFetch("cookies"),
    apiFetch("proxies")
  ]);
  const [cfgRes, cookieRes, proxyRes] = results;
  for (const res of results) {
    if (res.status === "rejected" && isApiError(res.reason) && res.reason.status === 401) {
      return false;
    }
  }
  authBlocked = false;
  if (cfgRes.status === "fulfilled" && cfgRes.value) {
    const val = cfgRes.value;
    adminAuthRequired = Boolean(val.deploy?.admin_auth);
    if (btnLogout)
      btnLogout.hidden = !adminAuthRequired;
    if (sidebarAuthNote)
      sidebarAuthNote.textContent = adminAuthRequired ? "auth: token" : "auth: open";
    updateShellCounts({ protocol: Boolean(val.config?.web_channel) });
  }
  if (cookieRes.status === "fulfilled" && cookieRes.value) {
    const c = cookieRes.value;
    updateShellCounts({ accounts: { enabled: c.enabled ?? 0, total: c.total ?? 0 } });
  }
  if (proxyRes.status === "fulfilled" && proxyRes.value) {
    const items = Array.isArray(proxyRes.value.items) ? proxyRes.value.items : [];
    const enabledCount = items.filter((p) => p.enabled).length;
    updateShellCounts({ proxies: { enabled: enabledCount, total: items.length } });
  }
  return true;
}
function getHashView() {
  const h = window.location.hash.replace(/^#/, "");
  return isViewName(h) ? h : "overview";
}
function wireEvents() {
  setUnauthorizedHandler(showLoginDialog);
  if (loginDialog) {
    loginDialog.addEventListener("cancel", (e) => e.preventDefault());
  }
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = loginToken?.value ?? "";
    setAlert(loginError, "");
    if (loginSubmitBtn)
      loginSubmitBtn.disabled = true;
    try {
      await apiFetch("login", { method: "POST", body: { token } });
      authBlocked = false;
      adminAuthRequired = true;
      if (loginToken)
        loginToken.value = "";
      if (loginDialog?.open)
        loginDialog.close();
      if (btnLogout)
        btnLogout.hidden = false;
      await loadShellInfo();
      navigate(currentView, { refresh: true });
    } catch (err) {
      setAlert(loginError, errMessage(err, "Unauthorized"));
      loginToken?.focus();
    } finally {
      if (loginSubmitBtn)
        loginSubmitBtn.disabled = false;
    }
  });
  btnLogout?.addEventListener("click", async () => {
    try {
      await apiFetch("logout", { method: "POST" });
    } catch (err) {
      toast(errMessage(err, `${t("header.logout")} failed`), "err");
    }
    clearMountedViews();
    showLoginDialog();
  });
  sidebarNav?.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element))
      return;
    const btn = target.closest(".nav-btn[data-view]");
    if (!btn)
      return;
    const view = btn.dataset.view;
    if (isViewName(view)) {
      navigate(view);
    }
  });
  btnMobileMenu?.addEventListener("click", toggleMobileMenu);
  document.addEventListener("click", (e) => {
    if (!sidebarNav?.classList.contains("is-open"))
      return;
    const target = e.target;
    if (!(target instanceof Node))
      return;
    if (sidebarNav.contains(target) || btnMobileMenu?.contains(target))
      return;
    closeMobileMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebarNav?.classList.contains("is-open")) {
      closeMobileMenu();
      btnMobileMenu?.focus();
    }
  });
  quickSearchForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = quickAuditSearch?.value.trim() || "";
    navigate("traffic", { tab: "audits", q });
  });
  btnQuickProbe?.addEventListener("click", () => {
    navigate("egress", { focusProbe: true });
  });
  btnGlobalRefresh?.addEventListener("click", () => {
    loadHealth();
    loadShellInfo();
    instances[currentView]?.refresh?.();
  });
  btnThemeToggle?.addEventListener("click", toggleTheme);
  btnLangToggle?.addEventListener("click", () => {
    const next = getLang() === "zh" ? "en" : "zh";
    setLang(next);
    updateThemeUI();
    for (const view of VALID_VIEWS) {
      if (instances[view]) {
        const sec = document.getElementById(`view-${view}`);
        if (sec)
          applyI18n(sec);
      }
    }
    instances[currentView]?.refresh?.();
  });
  window.addEventListener("hashchange", () => {
    const nextView = getHashView();
    if (nextView !== currentView) {
      navigate(nextView);
    }
  });
}
async function boot() {
  setLang(getLang());
  updateThemeUI();
  wireDialogLightDismiss(document);
  wireEvents();
  currentView = getHashView();
  loadHealth();
  await loadShellInfo();
  navigate(currentView);
}
boot();
