// Auto-generated from web/src/views-overview.ts via `bun run web/build.ts`. Do not edit directly.
import {
  apiFetch,
  errMessage,
  fmtMs,
  fmtNum,
  isApiError,
  rootFetch
} from "./api.js";
import { applyI18n, bi, t } from "./i18n.js";
import {
  el,
  renderTable,
  toast,
  uiBadge,
  uiButton,
  uiEmptyState,
  uiPageHeader,
  uiSectionPanel,
  uiStatCard,
  uiStatGrid
} from "./ui.js";
function getChartConstructor() {
  return window.Chart;
}
function resolveThemeColor(kind, fallback) {
  const probe = el("span", {
    class: `color-probe color-probe--${kind}`,
    "aria-hidden": "true"
  });
  document.documentElement.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed || fallback;
}
function withAlpha(color, alpha) {
  const rgbMatch = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }
  const hex = color.replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}
function fmtBucket(unixSec, range) {
  const d = new Date(Number(unixSec || 0) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}:00`;
  if (range === "30d")
    return md;
  if (range === "7d")
    return `${md} ${hm}`;
  return hm;
}
function openErrorSample(row) {
  const dlg = document.getElementById("errorSampleDialog");
  const titleEl = document.getElementById("errorSampleTitle");
  const codeEl = document.getElementById("errorSampleCode");
  if (!dlg || !titleEl || !codeEl) {
    toast(`${row.kind}: ${row.sample || ""}`, "err", 5000);
    return;
  }
  titleEl.textContent = `${row.kind || "error"} · ${fmtNum(row.count)}`;
  codeEl.textContent = row.sample || bi("（无原始错误样本）", "(No error sample)");
  if (!dlg.open)
    dlg.showModal();
}
export function mountOverview(container, ctx) {
  const state = {
    range: "24h",
    metric: "traffic",
    stats: null,
    series: [],
    cookies: null,
    usage: null,
    root: null
  };
  let chartInstance = null;
  let refreshSeq = 0;
  container.innerHTML = "";
  const refreshBtn = uiButton({
    i18n: "header.refresh_btn",
    onClick: () => {
      refresh();
    }
  });
  const headerRefs = uiPageHeader({
    titleI18n: "overview.title",
    subtitleI18n: "overview.subtitle",
    actions: [refreshBtn]
  });
  const kpiCards = {
    requests: uiStatCard({ labelI18n: "overview.kpi.requests" }),
    success: uiStatCard({ labelI18n: "overview.kpi.success" }),
    latency: uiStatCard({ labelI18n: "overview.kpi.latency" }),
    tokens: uiStatCard({ labelI18n: "overview.kpi.tokens" }),
    accounts: uiStatCard({ labelI18n: "overview.kpi.accounts" }),
    egress: uiStatCard({ labelI18n: "overview.kpi.egress" })
  };
  const kpiGrid = uiStatGrid(kpiCards.requests.root, kpiCards.success.root, kpiCards.latency.root, kpiCards.tokens.root, kpiCards.accounts.root, kpiCards.egress.root);
  const ranges = ["24h", "7d", "30d"];
  const rangeBtns = ranges.map((rng) => {
    const btn = uiButton({
      text: rng,
      size: "sm",
      active: rng === state.range,
      onClick: () => {
        setRange(rng);
      }
    });
    btn.dataset.range = rng;
    return btn;
  });
  const metricDefs = [
    { key: "traffic", i18n: "overview.chart.metric_traffic" },
    { key: "latency", i18n: "overview.chart.metric_latency" },
    { key: "tokens", i18n: "overview.chart.metric_tokens" }
  ];
  const metricBtns = metricDefs.map((m) => {
    const btn = uiButton({
      i18n: m.i18n,
      size: "sm",
      active: m.key === state.metric,
      onClick: () => setMetric(m.key)
    });
    btn.dataset.metric = m.key;
    return btn;
  });
  const chartCanvas = el("canvas", { "aria-label": t("overview.chart.title") });
  const chartEmpty = uiEmptyState(t("common.empty"));
  chartEmpty.hidden = true;
  const chartNote = el("div", { class: "kpi-card__sub chart-note", hidden: true });
  const chartBox = el("div", { class: "chart-box" }, chartCanvas);
  const chartPanel = uiSectionPanel({
    titleI18n: "overview.chart.title",
    actions: [
      el("div", { class: "row-actions", role: "group", "aria-label": "Time range" }, ...rangeBtns),
      el("div", { class: "row-actions", role: "group", "aria-label": "Dataset metric" }, ...metricBtns)
    ],
    body: [chartBox, chartEmpty, chartNote]
  });
  const modelsTableWrap = el("div");
  const proxiesTableWrap = el("div");
  const errorsTableWrap = el("div");
  const modelsPanel = uiSectionPanel({
    titleI18n: "overview.models.title",
    body: [modelsTableWrap]
  });
  const proxiesPanel = uiSectionPanel({
    titleI18n: "overview.proxies.title",
    body: [proxiesTableWrap]
  });
  const errorsPanel = uiSectionPanel({
    titleI18n: "overview.errors.title",
    body: [errorsTableWrap]
  });
  const breakdownGrid = el("div", { class: "grid-2" }, modelsPanel.root, proxiesPanel.root);
  const viewStack = el("div", { class: "view-stack" }, headerRefs.root, kpiGrid, chartPanel.root, breakdownGrid, errorsPanel.root);
  container.append(viewStack);
  function destroyChart() {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    const ChartCtor = getChartConstructor();
    if (typeof ChartCtor === "function" && typeof ChartCtor.getChart === "function") {
      const stale = ChartCtor.getChart(chartCanvas);
      if (stale)
        stale.destroy();
    }
  }
  function renderKpis() {
    const s = state.stats;
    const totalReq = Number(s?.total_requests ?? 0);
    const okCount = Number(s?.success ?? 0);
    const failCount = Number(s?.failures ?? 0);
    const rate = totalReq > 0 ? `${(Number(s?.success_rate ?? 0) * 100).toFixed(1)}%` : "0.0%";
    const avgMs = Number(s?.avg_ms ?? 0);
    const pt = Number(s?.prompt_tokens ?? 0);
    const ot = Number(s?.output_tokens ?? 0);
    const windowHours = Number(s?.window_hours ?? 24);
    kpiCards.requests.valueEl.textContent = fmtNum(totalReq);
    kpiCards.requests.subEl.textContent = bi(`成功 ${fmtNum(okCount)} · 失败 ${fmtNum(failCount)}`, `${fmtNum(okCount)} ok · ${fmtNum(failCount)} err`);
    kpiCards.success.valueEl.textContent = rate;
    kpiCards.success.subEl.textContent = totalReq > 0 ? bi(`失败 ${fmtNum(failCount)} 次`, `${fmtNum(failCount)} failures`) : bi("24h 无请求", "No traffic in 24h");
    kpiCards.latency.valueEl.textContent = fmtMs(avgMs);
    kpiCards.latency.subEl.textContent = bi(`统计窗口 ${windowHours}h`, `Window ${windowHours}h`);
    kpiCards.tokens.valueEl.textContent = fmtNum(pt + ot);
    kpiCards.tokens.subEl.textContent = bi(`输入 ${fmtNum(pt)} · 输出 ${fmtNum(ot)}`, `In ${fmtNum(pt)} · Out ${fmtNum(ot)}`);
    const cookieTotal = Number(state.cookies?.total ?? 0);
    const cookieEnabled = Number(state.cookies?.enabled ?? 0);
    const cookieItems = Array.isArray(state.cookies?.items) ? state.cookies.items : [];
    const deadCount = cookieItems.filter((it) => it.health === "dead").length;
    kpiCards.accounts.valueEl.textContent = state.cookies ? `${cookieEnabled} / ${cookieTotal}` : "—";
    kpiCards.accounts.subEl.textContent = state.cookies ? deadCount > 0 ? bi(`${deadCount} 个鉴权异常`, `${deadCount} failing auth`) : bi("启用 / 总账号数", "Enabled / Total") : "";
    const usageItems = Array.isArray(state.usage?.items) ? state.usage.items : [];
    const totalSlots = usageItems.length;
    const activeSlots = usageItems.filter((u) => u.name !== "(已删除)").length;
    const totalInflight = usageItems.reduce((acc, u) => acc + Number(u.inflight || 0), 0);
    kpiCards.egress.valueEl.textContent = state.usage ? `${activeSlots} / ${totalSlots}` : "—";
    kpiCards.egress.subEl.textContent = state.usage ? bi(`并发 ${totalInflight} · 活跃出口槽`, `${totalInflight} inflight · Active / Total`) : "";
  }
  function renderChart() {
    destroyChart();
    for (const btn of rangeBtns) {
      btn.classList.toggle("btn--active", btn.dataset.range === state.range);
    }
    for (const btn of metricBtns) {
      btn.classList.toggle("btn--active", btn.dataset.metric === state.metric);
    }
    const series = state.series;
    if (series.length === 0) {
      chartBox.hidden = true;
      chartEmpty.textContent = t("common.empty");
      chartEmpty.hidden = false;
      chartNote.hidden = true;
      return;
    }
    const ChartCtor = getChartConstructor();
    if (typeof ChartCtor !== "function") {
      chartBox.hidden = true;
      chartEmpty.textContent = "Chart.js unavailable";
      chartEmpty.hidden = false;
      chartNote.hidden = true;
      return;
    }
    const ctx2d = chartCanvas.getContext("2d");
    if (!ctx2d)
      return;
    chartBox.hidden = false;
    chartEmpty.hidden = true;
    if (state.range === "24h" && state.metric === "latency") {
      chartNote.textContent = bi("提示：24h 曲线由原始 requests 实时聚合，P50/P95 分位仅在 7d / 30d 聚合表中计算。", "Note: 24h series aggregates raw requests directly; P50/P95 percentiles are computed in 7d / 30d buckets.");
      chartNote.hidden = false;
    } else {
      chartNote.hidden = true;
    }
    const textColor = resolveThemeColor("text-secondary", "#64748b");
    const gridColor = resolveThemeColor("border", "#dbe2ea");
    const accentColor = resolveThemeColor("accent", "#0284c7");
    const okColor = resolveThemeColor("ok", "#059669");
    const warnColor = resolveThemeColor("warn", "#d97706");
    const labels = series.map((pt) => fmtBucket(pt.bucket, state.range));
    let datasets;
    if (state.metric === "latency") {
      datasets = [
        {
          label: "P50 (ms)",
          data: series.map((pt) => Number(pt.p50_ms || 0)),
          borderColor: accentColor,
          backgroundColor: withAlpha(accentColor, 0.14),
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        },
        {
          label: "P95 (ms)",
          data: series.map((pt) => Number(pt.p95_ms || 0)),
          borderColor: warnColor,
          backgroundColor: withAlpha(warnColor, 0.08),
          fill: false,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        }
      ];
    } else if (state.metric === "tokens") {
      datasets = [
        {
          label: bi("输入令牌 (Prompt)", "Prompt Tokens"),
          data: series.map((pt) => Number(pt.prompt_tokens || 0)),
          borderColor: accentColor,
          backgroundColor: withAlpha(accentColor, 0.16),
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        },
        {
          label: bi("输出令牌 (Output)", "Output Tokens"),
          data: series.map((pt) => Number(pt.output_tokens || 0)),
          borderColor: okColor,
          backgroundColor: withAlpha(okColor, 0.12),
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        }
      ];
    } else {
      datasets = [
        {
          label: bi("总请求", "Requests"),
          data: series.map((pt) => Number(pt.requests || 0)),
          borderColor: accentColor,
          backgroundColor: withAlpha(accentColor, 0.16),
          fill: true,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        },
        {
          label: bi("成功数", "Successes"),
          data: series.map((pt) => Number(pt.successes || 0)),
          borderColor: okColor,
          backgroundColor: withAlpha(okColor, 0.12),
          fill: false,
          tension: 0.25,
          pointRadius: 2,
          borderWidth: 2
        }
      ];
    }
    chartInstance = new ChartCtor(ctx2d, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: textColor,
              boxWidth: 12,
              font: { size: 12 }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { color: withAlpha(gridColor, 0.5) }
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor },
            grid: { color: withAlpha(gridColor, 0.65) }
          }
        }
      }
    });
  }
  function renderBreakdowns() {
    const s = state.stats;
    const byModel = Array.isArray(s?.by_model) ? s.by_model : [];
    const byProxy = Array.isArray(s?.by_proxy) ? s.by_proxy : [];
    const errors = Array.isArray(s?.error_breakdown) ? s.error_breakdown : [];
    renderTable(modelsTableWrap, {
      ariaLabel: t("overview.models.title"),
      rows: byModel,
      emptyText: t("common.empty"),
      columns: [
        {
          key: "model",
          label: bi("模型", "Model"),
          rowHeader: true,
          render: (r) => el("span", { class: "mono" }, r.model || "-")
        },
        {
          key: "requests",
          label: bi("请求", "Req"),
          align: "right",
          render: (r) => fmtNum(r.requests)
        },
        {
          key: "success",
          label: bi("成功 / 成功率", "OK / Rate"),
          align: "right",
          render: (r) => {
            const req = Number(r.requests || 0);
            const ok = Number(r.success || 0);
            const pct = req > 0 ? `${(ok / req * 100).toFixed(1)}%` : "-";
            return `${fmtNum(ok)} (${pct})`;
          }
        },
        {
          key: "avg_ms",
          label: bi("平均耗时", "Avg"),
          align: "right",
          render: (r) => fmtMs(r.avg_ms)
        },
        {
          key: "prompt_tokens",
          label: bi("输入 Token", "Prompt"),
          align: "right",
          render: (r) => fmtNum(r.prompt_tokens)
        },
        {
          key: "output_tokens",
          label: bi("输出 Token", "Output"),
          align: "right",
          render: (r) => fmtNum(r.output_tokens)
        }
      ]
    });
    renderTable(proxiesTableWrap, {
      ariaLabel: t("overview.proxies.title"),
      rows: byProxy,
      emptyText: t("common.empty"),
      columns: [
        {
          key: "proxy",
          label: bi("出口", "Egress"),
          rowHeader: true,
          render: (r) => el("span", { class: "mono" }, r.proxy || "(direct)")
        },
        {
          key: "requests",
          label: bi("请求", "Req"),
          align: "right",
          render: (r) => fmtNum(r.requests)
        },
        {
          key: "success",
          label: bi("成功 / 成功率", "OK / Rate"),
          align: "right",
          render: (r) => {
            const req = Number(r.requests || 0);
            const ok = Number(r.success || 0);
            const pct = req > 0 ? `${(ok / req * 100).toFixed(1)}%` : "-";
            return `${fmtNum(ok)} (${pct})`;
          }
        },
        {
          key: "avg_ms",
          label: bi("平均耗时", "Avg"),
          align: "right",
          render: (r) => fmtMs(r.avg_ms)
        }
      ]
    });
    renderTable(errorsTableWrap, {
      ariaLabel: t("overview.errors.title"),
      rows: errors,
      emptyText: bi("最近 24 小时无失败记录", "No errors in the last 24h"),
      onRowClick: openErrorSample,
      columns: [
        {
          key: "kind",
          label: bi("类别", "Kind"),
          rowHeader: true,
          render: (r) => uiBadge(r.kind || "unknown", "err")
        },
        {
          key: "count",
          label: bi("次数", "Count"),
          align: "right",
          render: (r) => fmtNum(r.count)
        },
        {
          key: "sample",
          label: bi("样本（点击查看完整详情）", "Sample (click to inspect)"),
          render: (r) => el("div", { class: "mono cell-trunc", title: r.sample || "" }, r.sample || "-")
        }
      ]
    });
  }
  function syncShellCounts() {
    const payload = {};
    if (state.cookies) {
      payload.accounts = `${Number(state.cookies.enabled || 0)}/${Number(state.cookies.total || 0)}`;
    }
    if (state.usage) {
      const items = Array.isArray(state.usage.items) ? state.usage.items : [];
      const active = items.filter((u) => u.name !== "(已删除)").length;
      payload.proxies = `${active}/${items.length}`;
    }
    if (state.root?.version) {
      payload.version = state.root.version;
    }
    ctx.updateShellCounts(payload);
  }
  async function setRange(rng) {
    if (state.range === rng)
      return;
    state.range = rng;
    try {
      const tsRes = await apiFetch(`timeseries?range=${encodeURIComponent(state.range)}`);
      state.series = Array.isArray(tsRes?.series) ? tsRes.series : [];
      renderChart();
    } catch (err) {
      if (!isApiError(err) || err.status !== 401)
        toast(errMessage(err), "err");
    }
  }
  function setMetric(metric) {
    if (state.metric === metric)
      return;
    state.metric = metric;
    renderChart();
  }
  async function refresh() {
    const seq = ++refreshSeq;
    refreshBtn.disabled = true;
    try {
      const results = await Promise.allSettled([
        apiFetch("stats?hours=24"),
        apiFetch(`timeseries?range=${encodeURIComponent(state.range)}`),
        apiFetch("cookies"),
        apiFetch("usage"),
        rootFetch("")
      ]);
      if (seq !== refreshSeq)
        return;
      const unauth = results.some((r) => r.status === "rejected" && isApiError(r.reason) && r.reason.status === 401);
      if (unauth)
        return;
      const [statsRes, tsRes, cookiesRes, usageRes, rootRes] = results;
      if (statsRes.status === "fulfilled")
        state.stats = statsRes.value;
      if (tsRes.status === "fulfilled")
        state.series = Array.isArray(tsRes.value?.series) ? tsRes.value.series : [];
      if (cookiesRes.status === "fulfilled")
        state.cookies = cookiesRes.value;
      if (usageRes.status === "fulfilled")
        state.usage = usageRes.value;
      if (rootRes.status === "fulfilled")
        state.root = rootRes.value;
      const firstErr = results.find((r) => r.status === "rejected");
      if (firstErr)
        toast(errMessage(firstErr.reason, "Load error"), "err");
      applyI18n(container);
      chartCanvas.setAttribute("aria-label", t("overview.chart.title"));
      renderKpis();
      renderChart();
      renderBreakdowns();
      syncShellCounts();
    } finally {
      if (seq === refreshSeq)
        refreshBtn.disabled = false;
    }
  }
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaScheme && typeof MutationObserver === "function") {
    const obs = new MutationObserver(() => {
      if (!container.isConnected) {
        obs.disconnect();
        return;
      }
      if (state.series.length > 0 && !container.hidden) {
        renderChart();
      }
    });
    obs.observe(metaScheme, { attributes: true, attributeFilter: ["content"] });
  }
  const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (mql && typeof mql.addEventListener === "function") {
    mql.addEventListener("change", () => {
      if (container.isConnected && !container.hidden && state.series.length > 0) {
        renderChart();
      }
    });
  }
  refresh();
  return { refresh };
}
