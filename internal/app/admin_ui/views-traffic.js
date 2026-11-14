// Auto-generated from web/src/views-traffic.ts via `bun run web/build.ts`. Do not edit directly.
import {
  apiFetch,
  errMessage,
  fmtBytes,
  fmtDuration,
  fmtMs,
  fmtNum,
  fmtRel,
  fmtTime,
  isApiError
} from "./api.js";
import { applyI18n, bi, t } from "./i18n.js";
import {
  biEl,
  confirmDialog,
  copyText,
  el,
  renderTable,
  toast,
  uiAlert,
  uiBadge,
  uiButton,
  uiCodeBlock,
  uiCodePanel,
  uiEmptyState,
  uiField,
  uiFilterBar,
  uiKeyValueGrid,
  uiModalDialog,
  uiPageHeader,
  uiTabs,
  wireDialogLightDismiss
} from "./ui.js";
function isTrafficTab(v) {
  return v === "audits" || v === "requests" || v === "sessions";
}
function biButton(zh, en, opts = {}) {
  const btn = uiButton({ ...opts, text: bi(zh, en) });
  btn.dataset.biZh = zh;
  btn.dataset.biEn = en;
  return btn;
}
function ensureSelectValue(selectEl, val) {
  const s = String(val || "");
  if (s && !Array.from(selectEl.options).some((o) => o.value === s)) {
    selectEl.append(el("option", { value: s }, s));
  }
  selectEl.value = s;
}
function normalizeMediaUrl(url) {
  if (!url)
    return "";
  if (url.startsWith("/admin/api/"))
    return url.slice("/admin/".length);
  return url;
}
function prettyMaybeJSON(val) {
  if (val == null)
    return "";
  if (typeof val !== "string") {
    try {
      return JSON.stringify(val, null, 2);
    } catch {
      return String(val);
    }
  }
  const trimmed = val.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return val;
    }
  }
  return val;
}
function statusBadgeTone(status, failed = 0) {
  const code = Number(status || 0);
  if (failed === 1 || code >= 500 || code <= 0)
    return "err";
  if (code >= 400)
    return "warn";
  if (code >= 200 && code < 300)
    return "ok";
  return "default";
}
function toEpochSec(datetimeLocalVal) {
  if (!datetimeLocalVal)
    return "";
  const ms = new Date(datetimeLocalVal).getTime();
  if (!Number.isFinite(ms))
    return "";
  return String(Math.floor(ms / 1000));
}
function renderAuditBlockCard(block) {
  const bType = block.type || "text";
  const cls = bType === "thinking" ? "chat-block chat-block--thinking" : bType === "tool_call" || bType === "tool_result" ? "chat-block chat-block--tool" : "chat-block";
  const metaNodes = [uiBadge(bType)];
  if (block.role)
    metaNodes.push(uiBadge(block.role, "accent"));
  if (block.name)
    metaNodes.push(el("span", { class: "mono" }, block.name));
  if (block.mime)
    metaNodes.push(el("span", { class: "mono" }, block.mime));
  const bodyNodes = [];
  if (block.url) {
    const src = normalizeMediaUrl(block.url);
    if (bType === "image") {
      bodyNodes.push(el("img", {
        class: "audit-media-img",
        src,
        loading: "lazy",
        alt: block.mime || "audit image"
      }));
    } else if (bType === "video") {
      bodyNodes.push(el("video", {
        class: "audit-media-video",
        controls: true,
        preload: "metadata",
        src
      }));
    } else if (bType === "audio") {
      bodyNodes.push(el("audio", {
        class: "audit-media-audio",
        controls: true,
        preload: "metadata",
        src
      }));
    }
    bodyNodes.push(el("div", { class: "mono text-xs text-break" }, el("a", { href: src, target: "_blank", rel: "noopener" }, src)));
  }
  if (block.args) {
    bodyNodes.push(uiCodeBlock({
      code: prettyMaybeJSON(block.args),
      ariaLabel: block.name ? `${block.name} args` : "Block args"
    }));
  }
  if (block.text) {
    bodyNodes.push(el("div", { class: "text-prewrap" }, block.text));
  }
  return el("div", { class: cls }, el("div", { class: "chat-block__meta" }, ...metaNodes), ...bodyNodes);
}
function renderMediaCards(auditId, side, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return uiEmptyState(bi("无多媒体项目", "No media items"));
  }
  return el("div", { class: "media-grid" }, ...items.map((item) => {
    const itemSide = item.side || side;
    const src = `api/audits/${encodeURIComponent(auditId)}/media/${encodeURIComponent(itemSide)}/${encodeURIComponent(item.idx)}`;
    const kind = item.kind || (item.mime?.startsWith("image/") ? "image" : item.mime?.startsWith("video/") ? "video" : item.mime?.startsWith("audio/") ? "audio" : "file");
    let preview;
    if (kind === "image") {
      preview = el("img", {
        class: "audit-media-img",
        src,
        loading: "lazy",
        alt: `${itemSide} media #${item.idx}`
      });
    } else if (kind === "video") {
      preview = el("video", {
        class: "audit-media-video",
        controls: true,
        preload: "metadata",
        src
      });
    } else if (kind === "audio") {
      preview = el("audio", {
        class: "audit-media-audio",
        controls: true,
        preload: "metadata",
        src
      });
    } else {
      preview = el("a", { href: src, target: "_blank", rel: "noopener", class: "btn btn--sm" }, bi("打开文件", "Open file"));
    }
    return el("div", { class: "media-card" }, preview, el("div", { class: "media-card__meta" }, el("span", { class: "mono" }, `#${item.idx} ${item.mime || kind}`), el("span", { class: "mono" }, item.human_size || fmtBytes(item.bytes))), el("div", { class: "media-card__meta media-card__meta--muted" }, el("span", { class: "mono" }, item.source || itemSide), el("a", { href: src, target: "_blank", rel: "noopener" }, bi("原图/下载", "Open"))));
  }));
}
function populateSelect(selectEl, values, currentVal, allLabel, extraOpts = []) {
  const prev = currentVal != null ? String(currentVal) : selectEl.value;
  selectEl.replaceChildren();
  selectEl.append(el("option", { value: "", "data-i18n": "common.all" }, allLabel));
  const seen = new Set([""]);
  for (const extra of extraOpts) {
    if (!seen.has(extra.value)) {
      selectEl.append(biEl("option", { value: extra.value }, extra.zh, extra.en));
      seen.add(extra.value);
    }
  }
  for (const val of values) {
    if (!seen.has(val)) {
      selectEl.append(el("option", { value: val }, val));
      seen.add(val);
    }
  }
  ensureSelectValue(selectEl, prev);
}
export function mountTraffic(container, _ctx) {
  container.innerHTML = "";
  let activeTab = "audits";
  let facetsLoaded = false;
  let facetsCache = {
    models: [],
    accounts: [],
    issues: [],
    finishes: [],
    paths: []
  };
  let auditsSeq = 0;
  let requestsSeq = 0;
  let sessionsSeq = 0;
  let inspectSeq = 0;
  let suppressTabLoad = false;
  const auditState = {
    beforeId: null,
    afterId: null,
    cursorStack: [],
    lastData: null
  };
  const reqState = {
    offset: 0,
    lastData: null
  };
  const refreshBtn = uiButton({
    i18n: "header.refresh_btn",
    onClick: () => {
      refresh();
    }
  });
  const headerRefs = uiPageHeader({
    titleI18n: "traffic.title",
    subtitleI18n: "traffic.subtitle",
    actions: [refreshBtn]
  });
  const mainTabs = uiTabs({
    ariaLabel: t("traffic.title"),
    activeTab: "audits",
    tabs: [
      {
        key: "audits",
        id: "trafficTab-audits",
        panelId: "trafficPanel-audits",
        label: t("traffic.tab.audits"),
        i18n: "traffic.tab.audits"
      },
      {
        key: "requests",
        id: "trafficTab-requests",
        panelId: "trafficPanel-requests",
        label: t("traffic.tab.requests"),
        i18n: "traffic.tab.requests"
      },
      {
        key: "sessions",
        id: "trafficTab-sessions",
        panelId: "trafficPanel-sessions",
        label: t("traffic.tab.sessions"),
        i18n: "traffic.tab.sessions"
      }
    ],
    onSelect: (key) => {
      if (!isTrafficTab(key))
        return;
      activeTab = key;
      if (suppressTabLoad) {
        suppressTabLoad = false;
        return;
      }
      if (key === "audits") {
        if (!facetsLoaded)
          loadFacets();
        loadAudits();
      } else if (key === "requests") {
        loadRequests();
      } else {
        loadSessions();
      }
    }
  });
  const fQ = el("input", {
    type: "search",
    id: "audQ",
    placeholder: bi("关键词 / Trace / IP / 模型…", "Keyword / ID / IP / Model…")
  });
  const fStatus = el("select", { id: "audStatus" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")), el("option", { value: "ok" }, "2xx OK"), biEl("option", { value: "failed" }, "失败 (err / >=400)", "Failed (>=400)"), el("option", { value: "4xx" }, "4xx"), el("option", { value: "5xx" }, "5xx"));
  const fIssue = el("select", { id: "audIssue" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")));
  const fModel = el("select", { id: "audModel" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")));
  const fAccount = el("select", { id: "audAccount" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")));
  const fFinish = el("select", { id: "audFinish" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")));
  const fPath = el("select", { id: "audPath" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")));
  const fTools = el("select", { id: "audTools" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")), biEl("option", { value: "1" }, "含工具调用", "With tools"), biEl("option", { value: "0" }, "无工具调用", "No tools"));
  const fSince = el("input", { type: "datetime-local", id: "audSince", step: "1" });
  const fUntil = el("input", { type: "datetime-local", id: "audUntil", step: "1" });
  const fLimit = el("select", { id: "audLimit" }, el("option", { value: "25" }, "25"), el("option", { value: "50", selected: true }, "50"), el("option", { value: "100" }, "100"), el("option", { value: "200" }, "200"));
  const btnAuditSearch = biButton("筛选", "Apply", { type: "submit", variant: "primary" });
  const btnAuditReset = biButton("重置", "Reset", {
    onClick: () => {
      fQ.value = "";
      fStatus.value = "";
      fIssue.value = "";
      fModel.value = "";
      fAccount.value = "";
      fFinish.value = "";
      fPath.value = "";
      fTools.value = "";
      fSince.value = "";
      fUntil.value = "";
      fLimit.value = "50";
      loadAudits({ resetCursor: true });
    }
  });
  const btnRefreshFacets = biButton("刷新筛选项", "Refresh Facets", {
    onClick: () => {
      (async () => {
        await loadFacets();
        await loadAudits();
      })();
    }
  });
  const auditFilter = uiFilterBar([
    uiField({ labelEl: biEl("label", { for: "audQ" }, "关键词", "Query"), control: fQ, grow: true }),
    uiField({ labelEl: biEl("label", { for: "audStatus" }, "状态", "Status"), control: fStatus }),
    uiField({ labelEl: biEl("label", { for: "audIssue" }, "问题诊断", "Issue"), control: fIssue }),
    uiField({ labelEl: biEl("label", { for: "audModel" }, "模型", "Model"), control: fModel }),
    uiField({ labelEl: biEl("label", { for: "audAccount" }, "账号", "Account"), control: fAccount }),
    uiField({ labelEl: biEl("label", { for: "audFinish" }, "结束原因", "Finish"), control: fFinish }),
    uiField({ labelEl: biEl("label", { for: "audPath" }, "路径", "Path"), control: fPath }),
    uiField({ labelEl: biEl("label", { for: "audTools" }, "工具", "Tools"), control: fTools }),
    uiField({ labelEl: biEl("label", { for: "audSince" }, "起始时间", "Since"), control: fSince }),
    uiField({ labelEl: biEl("label", { for: "audUntil" }, "结束时间", "Until"), control: fUntil }),
    uiField({ labelEl: biEl("label", { for: "audLimit" }, "每页", "Limit"), control: fLimit, compact: true }),
    el("div", { class: "row-actions" }, btnAuditSearch, btnAuditReset, btnRefreshFacets)
  ], () => {
    loadAudits({ resetCursor: true });
  });
  const telemetryTotal = el("span", { class: "mono" }, "—");
  const telemetrySize = el("span", { class: "mono" }, "—");
  const telemetryRetention = el("span", { class: "mono" }, "—");
  const telemetryQueryMs = el("span", { class: "mono" }, "—");
  const telemetryStrip = el("div", { class: "row-actions", "aria-label": bi("审计存储遥测", "Audit storage telemetry") }, el("span", { class: "status-chip" }, biEl("span", {}, "匹配总数: ", "Total: "), telemetryTotal), el("span", { class: "status-chip" }, biEl("span", {}, "审计体积: ", "Size: "), telemetrySize), el("span", { class: "status-chip" }, biEl("span", {}, "保留天数: ", "Retention: "), telemetryRetention), el("span", { class: "status-chip" }, biEl("span", {}, "查询耗时: ", "Query: "), telemetryQueryMs));
  const auditsTableWrap = el("div");
  const btnAudPrev = biButton("← 上一页 (较新)", "← Prev (Newer)", { size: "sm", disabled: true });
  const btnAudFirst = biButton("回到最新", "Latest", { size: "sm", disabled: true });
  const btnAudNext = biButton("下一页 (更旧) →", "Next (Older) →", { size: "sm", disabled: true });
  const audPageInfo = el("span", { class: "pagination__info" }, "");
  const auditsPagination = el("div", { class: "pagination" }, audPageInfo, el("div", { class: "row-actions" }, btnAudFirst, btnAudPrev, btnAudNext));
  mainTabs.panelBodies.audits.append(auditFilter.root, telemetryStrip, auditsTableWrap, auditsPagination);
  const reqModelList = el("datalist", { id: "reqModelDatalist" });
  const rModel = el("input", {
    type: "search",
    id: "reqModel",
    list: "reqModelDatalist",
    placeholder: bi("按模型过滤…", "Filter by model…")
  });
  const rStatus = el("select", { id: "reqStatus" }, el("option", { value: "", "data-i18n": "common.all" }, t("common.all")), biEl("option", { value: "ok" }, "成功 (200)", "OK (200)"), biEl("option", { value: "fail" }, "失败 (<>200)", "Fail (<>200)"));
  const rLimit = el("select", { id: "reqLimit" }, el("option", { value: "25" }, "25"), el("option", { value: "50", selected: true }, "50"), el("option", { value: "100" }, "100"), el("option", { value: "200" }, "200"));
  const btnReqApply = biButton("查询", "Filter", { type: "submit", variant: "primary" });
  const btnReqReset = biButton("重置", "Reset", {
    onClick: () => {
      rModel.value = "";
      rStatus.value = "";
      rLimit.value = "50";
      loadRequests({ resetOffset: true });
    }
  });
  const reqFilter = uiFilterBar([
    uiField({
      labelEl: biEl("label", { for: "reqModel" }, "模型", "Model"),
      control: rModel,
      extra: reqModelList,
      grow: true
    }),
    uiField({ labelEl: biEl("label", { for: "reqStatus" }, "状态", "Status"), control: rStatus }),
    uiField({ labelEl: biEl("label", { for: "reqLimit" }, "每页", "Limit"), control: rLimit, compact: true }),
    el("div", { class: "row-actions" }, btnReqApply, btnReqReset)
  ], () => {
    loadRequests({ resetOffset: true });
  });
  const requestsTableWrap = el("div");
  const reqPageInfo = el("span", { class: "pagination__info" }, "");
  const btnReqPrev = biButton("← 上一页", "← Prev", { size: "sm", disabled: true });
  const btnReqNext = biButton("下一页 →", "Next →", { size: "sm", disabled: true });
  const requestsPagination = el("div", { class: "pagination" }, reqPageInfo, el("div", { class: "row-actions" }, btnReqPrev, btnReqNext));
  mainTabs.panelBodies.requests.append(reqFilter.root, requestsTableWrap, requestsPagination);
  const sessCountChip = el("span", { class: "status-chip" }, "0");
  const btnSessRefresh = uiButton({
    i18n: "common.refresh",
    size: "sm",
    onClick: () => {
      loadSessions();
    }
  });
  const btnSessClear = biButton("清空全部会话", "Clear All Sessions", {
    variant: "danger",
    size: "sm",
    onClick: () => {
      (async () => {
        const confirmed = await confirmDialog({
          title: bi("清空全部活跃会话", "Clear All Active Sessions"),
          message: bi("确认驱逐当前内存中的全部多轮会话状态？", "Evict all active multi-turn conversation sessions from memory?"),
          confirmText: bi("确认清空", "Clear All"),
          danger: true
        });
        if (!confirmed)
          return;
        try {
          const res = await apiFetch("conversations", { method: "DELETE" });
          toast(bi(`已清空 ${res?.deleted ?? 0} 个会话`, `Cleared ${res?.deleted ?? 0} sessions`), "ok");
          loadSessions();
        } catch (err) {
          if (!isApiError(err) || err.status !== 401)
            toast(errMessage(err), "err");
        }
      })();
    }
  });
  const sessionsBar = el("div", { class: "pagination" }, el("div", { class: "row-actions" }, biEl("span", { class: "font-semibold" }, "活跃多轮会话", "Active Multi-turn Sessions"), sessCountChip), el("div", { class: "row-actions" }, btnSessRefresh, btnSessClear));
  const sessionsTableWrap = el("div");
  mainTabs.panelBodies.sessions.append(sessionsBar, sessionsTableWrap);
  const dlgSub = el("div", { class: "dialog__sub" }, "");
  const dlgExportBtn = biButton("导出 JSON", "Export JSON", { size: "sm", disabled: true });
  const dlgDeleteBtn = biButton("删除记录", "Delete Record", { variant: "danger", size: "sm", disabled: true });
  const dlgBody = el("div", { class: "dialog__body" });
  const existingDlg = document.getElementById("auditInspectorDialog");
  if (existingDlg)
    existingDlg.remove();
  const auditDlg = uiModalDialog({
    id: "auditInspectorDialog",
    titleId: "auditDlgTitle",
    closedby: "any",
    drawer: true,
    title: bi("审计详情", "Audit Inspector"),
    subtitle: dlgSub,
    headerActions: [dlgExportBtn, dlgDeleteBtn],
    content: [dlgBody]
  });
  const viewStack = el("div", { class: "view-stack" }, headerRefs.root, mainTabs.tablist, ...mainTabs.panelElements, auditDlg.dialog);
  container.append(viewStack);
  wireDialogLightDismiss(container);
  async function loadFacets() {
    try {
      const data = await apiFetch("audits?models=1");
      facetsLoaded = true;
      facetsCache = {
        models: Array.isArray(data?.models) ? data.models : [],
        accounts: Array.isArray(data?.accounts) ? data.accounts : [],
        issues: Array.isArray(data?.issues) ? data.issues : [],
        finishes: Array.isArray(data?.finishes) ? data.finishes : [],
        paths: Array.isArray(data?.paths) ? data.paths : []
      };
      populateSelect(fModel, facetsCache.models, null, t("common.all"));
      populateSelect(fAccount, facetsCache.accounts, null, t("common.all"));
      populateSelect(fIssue, facetsCache.issues, null, t("common.all"), [
        { value: "any", zh: "仅异常 (any)", en: "Has issue (any)" },
        { value: "none", zh: "无异常 (none)", en: "No issue (none)" }
      ]);
      populateSelect(fFinish, facetsCache.finishes, null, t("common.all"));
      populateSelect(fPath, facetsCache.paths, null, t("common.all"));
      reqModelList.replaceChildren(...facetsCache.models.map((m) => el("option", { value: m })));
      if (data?.size_bytes != null)
        telemetrySize.textContent = fmtBytes(data.size_bytes);
      if (data?.retention_days != null)
        telemetryRetention.textContent = `${data.retention_days} d`;
    } catch (err) {
      if (!isApiError(err) || err.status !== 401)
        toast(errMessage(err), "err");
    }
  }
  function buildAuditParams() {
    const params = new URLSearchParams;
    params.set("limit", fLimit.value || "50");
    if (fStatus.value)
      params.set("status", fStatus.value);
    if (fIssue.value)
      params.set("issue", fIssue.value);
    if (fModel.value)
      params.set("model", fModel.value);
    if (fAccount.value)
      params.set("account", fAccount.value);
    if (fFinish.value)
      params.set("finish", fFinish.value);
    if (fTools.value)
      params.set("tools", fTools.value);
    if (fPath.value)
      params.set("path", fPath.value);
    if (fQ.value.trim())
      params.set("q", fQ.value.trim());
    const sinceEpoch = toEpochSec(fSince.value);
    if (sinceEpoch)
      params.set("since", sinceEpoch);
    const untilEpoch = toEpochSec(fUntil.value);
    if (untilEpoch)
      params.set("until", untilEpoch);
    if (auditState.beforeId)
      params.set("before_id", String(auditState.beforeId));
    if (auditState.afterId)
      params.set("after_id", String(auditState.afterId));
    return params;
  }
  async function loadAudits(opts = {}) {
    if (opts.resetCursor) {
      auditState.beforeId = null;
      auditState.afterId = null;
      auditState.cursorStack = [];
    }
    const seq = ++auditsSeq;
    try {
      const params = buildAuditParams();
      const data = await apiFetch(`audits?${params.toString()}`);
      if (seq !== auditsSeq)
        return;
      auditState.lastData = data;
      telemetryTotal.textContent = fmtNum(data?.total || 0);
      telemetrySize.textContent = fmtBytes(data?.size_bytes || 0);
      telemetryRetention.textContent = `${Number(data?.retention_days || 0)} d`;
      telemetryQueryMs.textContent = `${Number(data?.query_ms || 0)} ms`;
      const items = Array.isArray(data?.items) ? data.items : [];
      renderTable(auditsTableWrap, {
        ariaLabel: t("traffic.tab.audits"),
        rows: items,
        emptyText: t("common.empty"),
        onRowClick: (row) => {
          openAuditInspector(row.id);
        },
        columns: [
          {
            key: "id",
            label: "ID",
            rowHeader: true,
            render: (r) => el("div", { class: "row-actions" }, el("span", { class: "mono" }, `#${r.id}`), r.stream ? uiBadge("SSE", "accent") : null)
          },
          {
            key: "ts",
            label: bi("时间", "Time"),
            render: (r) => el("div", { class: "mono", title: fmtRel(r.ts) }, fmtTime(r.ts))
          },
          {
            key: "path",
            label: bi("方法与路径", "Method & Path"),
            render: (r) => el("div", { class: "cluster cluster--nowrap" }, uiBadge(r.method || "GET"), el("span", { class: "mono cell-trunc", title: r.path || "" }, r.path || "/"))
          },
          {
            key: "model",
            label: bi("模型 / 实际服务", "Model / Served"),
            render: (r) => {
              const m = r.model || "-";
              const sm = r.served_model && r.served_model !== r.model ? ` → ${r.served_model}` : "";
              return el("div", { class: "mono cell-trunc", title: `${m}${sm}` }, `${m}${sm}`);
            }
          },
          {
            key: "status",
            label: bi("状态 / 结束", "Status / Finish"),
            render: (r) => el("div", { class: "row-actions" }, uiBadge(String(r.status ?? 0), statusBadgeTone(r.status, r.failed)), r.finish_reason ? uiBadge(r.finish_reason) : null)
          },
          {
            key: "account",
            label: bi("账号 / 出口", "Account / Proxy"),
            render: (r) => el("div", { class: "mono cell-trunc", title: `${r.account || "-"} / ${r.proxy || "direct"}` }, `${r.account || "-"} / ${r.proxy || "direct"}`)
          },
          {
            key: "issue",
            label: bi("诊断问题", "Issue"),
            render: (r) => r.issue ? uiBadge(r.issue, r.failed ? "err" : "warn", { title: r.error_preview || r.issue }) : el("span", { class: "text-muted" }, "-")
          },
          {
            key: "total_ms",
            label: bi("TTFB / 总耗时", "TTFB / Total"),
            align: "right",
            render: (r) => `${fmtMs(r.ttfb_ms)} / ${fmtMs(r.total_ms)}`
          },
          {
            key: "tokens",
            label: bi("令牌 (In/Out)", "Tokens"),
            align: "right",
            render: (r) => el("div", { class: "cluster cluster--end" }, el("span", { class: "mono" }, `${fmtNum(r.prompt_tokens)} / ${fmtNum(r.output_tokens)}`), r.tool_call_count > 0 ? uiBadge(`T:${r.tool_call_count}`, "accent", { title: "Tool calls" }) : null)
          },
          {
            key: "media",
            label: bi("媒体", "Media"),
            align: "right",
            render: (r) => {
              const cnt = Number(r.media_summary?.total_count || 0);
              return cnt > 0 ? uiBadge(String(cnt), "accent") : "0";
            }
          }
        ]
      });
      const pageNum = auditState.cursorStack.length + 1;
      audPageInfo.textContent = items.length > 0 ? bi(`第 ${pageNum} 页 · 本页 ${items.length} 条 (#${items[0].id}..#${items[items.length - 1].id})`, `Page ${pageNum} · ${items.length} rows (#${items[0].id}..#${items[items.length - 1].id})`) : bi("无匹配记录", "0 rows");
      const hasPrev = auditState.cursorStack.length > 0 || Boolean(data?.has_newer && items.length > 0);
      btnAudPrev.disabled = !hasPrev;
      btnAudFirst.disabled = !auditState.beforeId && !auditState.afterId && auditState.cursorStack.length === 0;
      btnAudNext.disabled = !data?.has_more || !data?.next_before_id;
    } catch (err) {
      if (!isApiError(err) || err.status !== 401)
        toast(errMessage(err), "err");
    }
  }
  async function openAuditInspector(id) {
    const seq = ++inspectSeq;
    auditDlg.titleEl.textContent = bi(`审计记录 #${id}`, `Audit #${id}`);
    dlgSub.textContent = t("common.loading");
    dlgExportBtn.disabled = true;
    dlgDeleteBtn.disabled = true;
    dlgBody.replaceChildren(uiEmptyState(t("common.loading")));
    if (!auditDlg.dialog.open)
      auditDlg.dialog.showModal();
    try {
      const detail = await apiFetch(`audits/${encodeURIComponent(id)}`);
      if (seq !== inspectSeq)
        return;
      auditDlg.titleEl.textContent = `#${detail.id} ${detail.method || ""} ${detail.path || ""}`;
      dlgSub.textContent = `${fmtTime(detail.ts)} · ${detail.client_ip || "-"} · ${detail.model || "-"}${detail.served_model && detail.served_model !== detail.model ? ` → ${detail.served_model}` : ""}`;
      dlgExportBtn.disabled = false;
      dlgExportBtn.onclick = () => {
        const blob = new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: `audit-${detail.id}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      dlgDeleteBtn.disabled = false;
      dlgDeleteBtn.onclick = () => {
        (async () => {
          const confirmed = await confirmDialog({
            title: bi("删除审计记录", "Delete Audit Record"),
            message: bi(`确认永久删除审计记录 #${detail.id}？该操作不可恢复。`, `Permanently delete audit record #${detail.id}?`),
            confirmText: t("common.delete"),
            danger: true
          });
          if (!confirmed)
            return;
          try {
            await apiFetch(`audits/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
            toast(bi(`已删除审计记录 #${detail.id}`, `Deleted audit #${detail.id}`), "ok");
            auditDlg.dialog.close("");
            loadAudits();
          } catch (err) {
            if (!isApiError(err) || err.status !== 401)
              toast(errMessage(err), "err");
          }
        })();
      };
      const summaryGrid = uiKeyValueGrid([
        { key: "Status", value: String(detail.status ?? 0) },
        {
          key: "Model",
          value: `${detail.model || "-"}${detail.served_model && detail.served_model !== detail.model ? ` → ${detail.served_model}` : ""}`
        },
        { key: "Account / Proxy", value: `${detail.account || "-"} / ${detail.proxy || "direct"}` },
        {
          key: "TTFB / 1st / Total",
          value: `${fmtMs(detail.ttfb_ms)} / ${fmtMs(detail.first_data_ms)} / ${fmtMs(detail.total_ms)}`
        },
        {
          key: "Tokens (P/O/R/C)",
          value: `${fmtNum(detail.prompt_tokens)} / ${fmtNum(detail.output_tokens)} / ${fmtNum(detail.reasoning_tokens)} / ${fmtNum(detail.cached_tokens)}`
        },
        {
          key: "Attempts / Chunks / Pings",
          value: `${detail.attempts || 0} / ${detail.chunks || 0} / ${detail.pings || 0}`
        },
        { key: "Issue / Finish", value: `${detail.issue || "-"} / ${detail.finish_reason || "-"}` },
        { key: "Resp ID / Key FP", value: `${detail.resp_id || "-"} / ${detail.key_fp || "-"}` },
        { key: "User-Agent", value: detail.user_agent || "-" }
      ]);
      const errAlert = detail.error ? uiAlert({ message: detail.error, tone: "err" }) : null;
      const reqBlocks = Array.isArray(detail.request_blocks) ? detail.request_blocks : [];
      const resBlocks = Array.isArray(detail.response_blocks) ? detail.response_blocks : [];
      const reqMedia = Array.isArray(detail.req_media) ? detail.req_media : [];
      const resMedia = Array.isArray(detail.res_media) ? detail.res_media : [];
      const mediaSum = detail.media_summary ?? {
        req_count: 0,
        res_count: 0,
        total_count: 0,
        total_bytes: 0,
        human_size: "0 B"
      };
      const hasMcp = Boolean(detail.mcp_info || detail.tool_calls);
      const drawerTabs = uiTabs({
        ariaLabel: bi("审计包视图", "Audit payload sections"),
        activeTab: "blocks",
        tabs: [
          {
            key: "blocks",
            id: "dlgTab-blocks",
            panelId: "dlgPanel-blocks",
            label: bi(`内容块 (${reqBlocks.length + resBlocks.length})`, `Blocks (${reqBlocks.length + resBlocks.length})`)
          },
          {
            key: "media",
            id: "dlgTab-media",
            panelId: "dlgPanel-media",
            label: bi(`多媒体 (${mediaSum.total_count || 0})`, `Media (${mediaSum.total_count || 0})`)
          },
          {
            key: "mcp",
            id: "dlgTab-mcp",
            panelId: "dlgPanel-mcp",
            label: hasMcp ? "MCP / Tools •" : "MCP / Tools"
          },
          {
            key: "raw",
            id: "dlgTab-raw",
            panelId: "dlgPanel-raw",
            label: bi("原始报文", "Raw")
          }
        ]
      });
      const blocksBody = drawerTabs.panelBodies.blocks;
      if (detail.system_prompt) {
        blocksBody.append(el("h3", { class: "subhead" }, "System Prompt"), renderAuditBlockCard({ type: "text", role: "system", text: detail.system_prompt }));
      }
      blocksBody.append(el("h3", { class: "subhead" }, bi(`请求内容块 (${reqBlocks.length})`, `Request Blocks (${reqBlocks.length})`)));
      if (reqBlocks.length > 0) {
        blocksBody.append(...reqBlocks.map(renderAuditBlockCard));
      } else {
        blocksBody.append(uiEmptyState(bi("未提取到请求块", "No request blocks extracted")));
      }
      if (detail.reasoning) {
        blocksBody.append(el("h3", { class: "subhead" }, bi("推理过程 (Reasoning)", "Reasoning")), renderAuditBlockCard({ type: "thinking", role: "assistant", text: detail.reasoning }));
      }
      blocksBody.append(el("h3", { class: "subhead" }, bi(`响应内容块 (${resBlocks.length})`, `Response Blocks (${resBlocks.length})`)));
      if (resBlocks.length > 0) {
        blocksBody.append(...resBlocks.map(renderAuditBlockCard));
      } else {
        blocksBody.append(uiEmptyState(bi("未提取到响应块", "No response blocks extracted")));
      }
      drawerTabs.panelBodies.media.append(uiKeyValueGrid([
        { key: "req_count", value: String(mediaSum.req_count || 0) },
        { key: "res_count", value: String(mediaSum.res_count || 0) },
        { key: "total_count", value: String(mediaSum.total_count || 0) },
        { key: "human_size", value: mediaSum.human_size || "0 B" }
      ]), el("h3", { class: "subhead" }, bi(`请求媒体 (${reqMedia.length})`, `Request Media (${reqMedia.length})`)), renderMediaCards(detail.id, "req", reqMedia), el("h3", { class: "subhead" }, bi(`响应媒体 (${resMedia.length})`, `Response Media (${resMedia.length})`)), renderMediaCards(detail.id, "res", resMedia));
      const mcpBody = drawerTabs.panelBodies.mcp;
      if (!detail.mcp_info && !detail.tool_calls) {
        mcpBody.append(uiEmptyState(bi("本次请求无 MCP 或工具调用数据", "No MCP or tool call metadata")));
      } else {
        if (detail.mcp_info) {
          const m = detail.mcp_info;
          mcpBody.append(uiKeyValueGrid([
            { key: "method", value: m.method || "-" },
            { key: "id", value: m.id != null ? String(m.id) : "-" },
            { key: "tool_name", value: m.tool_name || "-" },
            { key: "is_error", value: String(Boolean(m.is_error)) },
            {
              key: "content_types",
              value: Array.isArray(m.content_types) && m.content_types.length ? m.content_types.join(", ") : "-"
            }
          ]));
          if (m.arguments !== undefined) {
            mcpBody.append(uiCodePanel({
              title: "mcp_info.arguments",
              text: prettyMaybeJSON(m.arguments),
              ariaLabel: "MCP arguments"
            }));
          }
        }
        if (detail.tool_calls) {
          mcpBody.append(uiCodePanel({
            title: "tool_calls",
            text: prettyMaybeJSON(detail.tool_calls),
            ariaLabel: "Tool calls"
          }));
        }
      }
      const rawBody = drawerTabs.panelBodies.raw;
      if (detail.raw_truncated) {
        rawBody.append(uiAlert({
          message: bi(`注意：上游原始响应已被截断存储（raw_bytes=${fmtBytes(detail.raw_bytes)}）`, `Note: raw upstream body was truncated (${fmtBytes(detail.raw_bytes)})`),
          tone: "warn"
        }));
      }
      rawBody.append(uiCodePanel({ title: "req_headers", text: prettyMaybeJSON(detail.req_headers), ariaLabel: "Request headers" }), uiCodePanel({ title: "res_headers", text: prettyMaybeJSON(detail.res_headers), ariaLabel: "Response headers" }), uiCodePanel({ title: "params", text: prettyMaybeJSON(detail.params), ariaLabel: "Request params" }), uiCodePanel({ title: "request_body", text: prettyMaybeJSON(detail.request_body), ariaLabel: "Request body" }), uiCodePanel({ title: "reply", text: detail.reply || "", ariaLabel: "Normalized reply" }), uiCodePanel({ title: "raw", text: detail.raw || "", ariaLabel: "Raw upstream response" }));
      dlgBody.replaceChildren(summaryGrid, ...errAlert ? [errAlert] : [], drawerTabs.tablist, ...drawerTabs.panelElements);
    } catch (err) {
      if (seq !== inspectSeq)
        return;
      if (isApiError(err) && err.status === 401) {
        auditDlg.dialog.close("");
        return;
      }
      dlgSub.textContent = "Error";
      dlgBody.replaceChildren(uiAlert({ message: errMessage(err), tone: "err" }));
    }
  }
  async function loadRequests(opts = {}) {
    if (opts.resetOffset)
      reqState.offset = 0;
    const seq = ++requestsSeq;
    const limit = Number(rLimit.value || 50);
    const params = new URLSearchParams;
    params.set("limit", String(limit));
    params.set("offset", String(reqState.offset));
    if (rModel.value.trim())
      params.set("model", rModel.value.trim());
    if (rStatus.value)
      params.set("status", rStatus.value);
    try {
      const data = await apiFetch(`requests?${params.toString()}`);
      if (seq !== requestsSeq)
        return;
      reqState.lastData = data;
      const items = Array.isArray(data?.items) ? data.items : [];
      const total = Number(data?.total || 0);
      const offset = Number(data?.offset || 0);
      renderTable(requestsTableWrap, {
        ariaLabel: t("traffic.tab.requests"),
        rows: items,
        emptyText: t("common.empty"),
        columns: [
          { key: "id", label: "ID", rowHeader: true, render: (r) => el("span", { class: "mono" }, `#${r.id}`) },
          { key: "ts", label: bi("时间", "Time"), render: (r) => el("span", { class: "mono" }, fmtTime(r.ts)) },
          { key: "endpoint", label: bi("端点", "Endpoint"), render: (r) => el("span", { class: "mono" }, r.endpoint || "-") },
          { key: "model", label: bi("模型", "Model"), render: (r) => el("span", { class: "mono" }, r.model || "-") },
          { key: "upstream_model", label: bi("上游模型", "Upstream"), render: (r) => el("span", { class: "mono" }, r.upstream_model || "-") },
          { key: "account_label", label: bi("账号", "Account"), render: (r) => el("span", { class: "mono" }, r.account_label || "-") },
          { key: "proxy_name", label: bi("出口", "Proxy"), render: (r) => el("span", { class: "mono" }, r.proxy_name || "direct") },
          {
            key: "status",
            label: bi("状态", "Status"),
            render: (r) => uiBadge(String(r.status ?? 0), statusBadgeTone(r.status))
          },
          { key: "ttfb_ms", label: "TTFB", align: "right", render: (r) => fmtMs(r.ttfb_ms) },
          { key: "total_ms", label: bi("总耗时", "Total"), align: "right", render: (r) => fmtMs(r.total_ms) },
          { key: "prompt_chars", label: bi("输入字符", "P.Chars"), align: "right", render: (r) => fmtNum(r.prompt_chars) },
          { key: "response_chars", label: bi("输出字符", "R.Chars"), align: "right", render: (r) => fmtNum(r.response_chars) },
          { key: "prompt_tokens", label: bi("输入Token", "P.Tok"), align: "right", render: (r) => fmtNum(r.prompt_tokens) },
          { key: "output_tokens", label: bi("输出Token", "O.Tok"), align: "right", render: (r) => fmtNum(r.output_tokens) },
          {
            key: "stream",
            label: "Stream",
            render: (r) => uiBadge(r.stream ? "SSE" : "Sync", r.stream ? "accent" : "default")
          },
          {
            key: "error",
            label: bi("错误", "Error"),
            render: (r) => r.error ? el("div", { class: "mono cell-trunc", title: r.error }, r.error) : "-"
          }
        ]
      });
      reqPageInfo.textContent = total > 0 ? bi(`显示 ${offset + 1}–${Math.min(offset + items.length, total)} / 共 ${fmtNum(total)} 条`, `Showing ${offset + 1}–${Math.min(offset + items.length, total)} of ${fmtNum(total)}`) : bi("0 条记录", "0 rows");
      btnReqPrev.disabled = offset <= 0;
      btnReqNext.disabled = offset + items.length >= total;
    } catch (err) {
      if (!isApiError(err) || err.status !== 401)
        toast(errMessage(err), "err");
    }
  }
  async function loadSessions() {
    const seq = ++sessionsSeq;
    try {
      const data = await apiFetch("conversations");
      if (seq !== sessionsSeq)
        return;
      const items = Array.isArray(data?.items) ? data.items : [];
      const total = Number(data?.total ?? items.length);
      sessCountChip.textContent = String(total);
      renderTable(sessionsTableWrap, {
        ariaLabel: t("traffic.tab.sessions"),
        rows: items,
        emptyText: bi("当前无活跃多轮会话", "No active multi-turn sessions"),
        columns: [
          {
            key: "key",
            label: "Key",
            rowHeader: true,
            render: (r) => el("div", { class: "cluster cluster--nowrap" }, el("span", { class: "mono cell-trunc cell-trunc--md", title: r.key }, r.key), biButton("复制", "Copy", {
              size: "sm",
              onClick: () => {
                copyText(r.key, "session key");
              }
            }))
          },
          {
            key: "cid",
            label: "CID",
            render: (r) => el("span", { class: "mono cell-trunc cell-trunc--sm", title: `cid=${r.cid}
rid=${r.rid}
rcid=${r.rcid}` }, r.cid || "-")
          },
          { key: "turn", label: bi("轮次", "Turn"), align: "right", render: (r) => fmtNum(r.turn) },
          {
            key: "is_login",
            label: bi("鉴权模式", "Mode"),
            render: (r) => uiBadge(r.is_login ? "Login" : "Anon", r.is_login ? "ok" : "default")
          },
          {
            key: "temp",
            label: bi("无痕", "Temp"),
            render: (r) => uiBadge(r.temp ? "temp" : "saved", r.temp ? "warn" : "default")
          },
          { key: "account_id", label: bi("账号 ID", "Acct ID"), align: "right", render: (r) => String(r.account_id ?? 0) },
          { key: "authuser", label: "AuthUser", render: (r) => el("span", { class: "mono" }, `/u/${r.authuser || "0"}`) },
          { key: "proxy_id", label: bi("代理 ID", "Proxy ID"), align: "right", render: (r) => String(r.proxy_id ?? 0) },
          {
            key: "updated_at",
            label: bi("更新时间", "Updated"),
            render: (r) => el("span", { class: "mono", title: fmtRel(r.updated_at) }, fmtTime(r.updated_at))
          },
          { key: "ttl_sec", label: "TTL", align: "right", render: (r) => fmtDuration(r.ttl_sec) },
          {
            key: "actions",
            label: bi("操作", "Action"),
            render: (r) => biButton("驱逐", "Evict", {
              variant: "danger",
              size: "sm",
              onClick: () => {
                (async () => {
                  try {
                    await apiFetch(`conversations?key=${encodeURIComponent(r.key)}`, { method: "DELETE" });
                    toast(bi("已驱逐会话", "Session evicted"), "ok");
                    loadSessions();
                  } catch (err) {
                    if (!isApiError(err) || err.status !== 401)
                      toast(errMessage(err), "err");
                  }
                })();
              }
            })
          }
        ]
      });
    } catch (err) {
      if (!isApiError(err) || err.status !== 401)
        toast(errMessage(err), "err");
    }
  }
  for (const sel of [fStatus, fIssue, fModel, fAccount, fFinish, fPath, fTools, fLimit]) {
    sel.addEventListener("change", () => {
      loadAudits({ resetCursor: true });
    });
  }
  btnAudFirst.addEventListener("click", () => {
    loadAudits({ resetCursor: true });
  });
  btnAudNext.addEventListener("click", () => {
    const nextBefore = auditState.lastData?.next_before_id;
    if (!nextBefore)
      return;
    auditState.cursorStack.push({ beforeId: auditState.beforeId, afterId: auditState.afterId });
    auditState.beforeId = nextBefore;
    auditState.afterId = null;
    loadAudits();
  });
  btnAudPrev.addEventListener("click", () => {
    if (auditState.cursorStack.length > 0) {
      const prev = auditState.cursorStack.pop();
      if (prev) {
        auditState.beforeId = prev.beforeId;
        auditState.afterId = prev.afterId;
        loadAudits();
        return;
      }
    }
    const firstItem = auditState.lastData?.items?.[0];
    if (firstItem) {
      auditState.beforeId = null;
      auditState.afterId = firstItem.id;
      loadAudits();
    }
  });
  rStatus.addEventListener("change", () => {
    loadRequests({ resetOffset: true });
  });
  rLimit.addEventListener("change", () => {
    loadRequests({ resetOffset: true });
  });
  btnReqPrev.addEventListener("click", () => {
    const limit = Number(rLimit.value || 50);
    reqState.offset = Math.max(0, reqState.offset - limit);
    loadRequests();
  });
  btnReqNext.addEventListener("click", () => {
    const limit = Number(rLimit.value || 50);
    reqState.offset += limit;
    loadRequests();
  });
  function syncStaticLabels() {
    applyI18n(container);
    fQ.placeholder = bi("关键词 / Trace / IP / 模型…", "Keyword / ID / IP / Model…");
    rModel.placeholder = bi("按模型过滤…", "Filter by model…");
    auditDlg.closeTopBtn.textContent = t("common.close");
    auditDlg.closeTopBtn.setAttribute("aria-label", t("common.close"));
  }
  function setSearchQuery(q) {
    fQ.value = q == null ? "" : String(q);
    if (activeTab !== "audits") {
      suppressTabLoad = true;
      mainTabs.controller.select("audits");
    }
    if (!facetsLoaded)
      loadFacets();
    return loadAudits({ resetCursor: true });
  }
  function refresh(opts = {}) {
    syncStaticLabels();
    if (opts.q !== undefined) {
      return setSearchQuery(opts.q);
    }
    if (opts.model !== undefined) {
      ensureSelectValue(fModel, opts.model);
    }
    if (opts.tab && isTrafficTab(opts.tab) && opts.tab !== activeTab) {
      mainTabs.controller.select(opts.tab);
      return;
    }
    if (activeTab === "audits") {
      if (!facetsLoaded)
        loadFacets();
      return loadAudits();
    }
    if (activeTab === "requests") {
      return loadRequests();
    }
    return loadSessions();
  }
  loadFacets();
  loadAudits();
  return { refresh, setSearchQuery };
}
