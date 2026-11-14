// Auto-generated from web/src/views-config.ts via `bun run web/build.ts`. Do not edit directly.
import { apiFetch, errMessage, isApiError } from "./api.js";
import { bi } from "./i18n.js";
import {
  confirmDialog,
  copyText,
  el,
  setAlert,
  toast,
  uiAlert,
  uiBadge,
  uiButton,
  uiCodeBlock,
  uiField,
  uiKeyValueGrid,
  uiPageHeader,
  uiSectionPanel,
  uiSwitchRow,
  uiTabs
} from "./ui.js";
const RUNTIME_CONFIG_EXHAUSTIVE = {
  retry_attempts: true,
  retry_delay_sec: true,
  request_timeout_sec: true,
  default_model: true,
  per_ip_concurrent: true,
  per_ip_rpm: true,
  per_ip_rph: true,
  retention_days: true,
  log_requests: true,
  impersonate: true,
  gemini_bl: true,
  proxy_cooldown_min: true,
  fallback_direct: true,
  fallback_anon: true,
  gemini_bl_auto: true,
  max_prompt_bytes: true,
  multi_turn: true,
  auto_delete_conversation: true,
  anon_first: true,
  temporary_chat: true,
  image_upscale: true,
  web_channel: true,
  firefox_fingerprint: true,
  strict_model: true,
  strict_model_cooldown_min: true,
  retry_on_timeout: true,
  stream_keepalive_sec: true,
  refusal_retry: true
};
const IMPERSONATE_SUGGESTIONS = [
  "chrome_146",
  "chrome_133",
  "chrome_131",
  "safari_18",
  "firefox_147",
  "chrome_144",
  "safari_16_0",
  "safari_ios_17_0"
];
const MCP_TOOLS = [
  { name: "web_search", descZh: "联网搜索并返回参考来源链接", descEn: "Search the web via Gemini and return synthesized citations" },
  { name: "generate_image", descZh: "Nano Banana 生图（支持参考图）", descEn: "Generate or restyle images (Nano Banana)" },
  { name: "generate_music", descZh: "Lyria ~30s 音乐生成", descEn: "Generate ~30s music clip (Lyria)" },
  { name: "create_video_task", descZh: "创建 Veo 异步视频任务", descEn: "Start async Veo video generation job" },
  { name: "get_video_status", descZh: "轮询 Veo 视频任务并可附带 MP4", descEn: "Poll video job status & optional MP4 attachment" },
  { name: "generate_canvas", descZh: "生成 Canvas 交互式 HTML 文档", descEn: "Generate interactive HTML document via Canvas" },
  { name: "analyze_media", descZh: "多模态理解图片或视频", descEn: "Analyze image/video URLs via Gemini" },
  { name: "ask_gemini", descZh: "委托指定 Gemini 模型深度推理", descEn: "Delegate reasoning to a specified Gemini model" }
];
const RUNTIME_GROUPS = [
  {
    id: "limits",
    zhTitle: "流量控制与熔断冷却 (Per-IP Slot)",
    enTitle: "Rate Limits & Egress Cooldown (Per-IP Slot)",
    fields: [
      {
        key: "per_ip_concurrent",
        type: "int",
        min: 0,
        max: 1000,
        zhLabel: "单出口并发上限",
        enLabel: "Per-IP Concurrent",
        zhHint: "同一时刻最多在飞请求数 (0..1000, 0=不限)",
        enHint: "Max inflight requests per slot (0..1000, 0=unlimited)"
      },
      {
        key: "per_ip_rpm",
        type: "int",
        min: 0,
        max: 1e4,
        zhLabel: "单出口 RPM 上限",
        enLabel: "Per-IP RPM",
        zhHint: "滚动 60s 窗口请求上限 (0..10000, 0=不限)",
        enHint: "Rolling 60s request cap (0..10000, 0=unlimited)"
      },
      {
        key: "per_ip_rph",
        type: "int",
        min: 0,
        max: 1e5,
        zhLabel: "单出口 RPH 上限",
        enLabel: "Per-IP RPH",
        zhHint: "滚动 1h 上限，对标 Google 80 RPH 红线 (0..100000, 0=不限)",
        enHint: "Rolling 1h cap vs 80 RPH Google threshold (0..100000, 0=unlimited)"
      },
      {
        key: "proxy_cooldown_min",
        type: "int",
        min: 0,
        max: 10080,
        zhLabel: "代理熔断冷却 (分钟)",
        enLabel: "Proxy Cooldown (min)",
        zhHint: "连续失败熔断后恢复等待时长 (0..10080, 0=不自动恢复)",
        enHint: "Recovery delay after proxy circuit break (0..10080, 0=manual)"
      }
    ]
  },
  {
    id: "retry",
    zhTitle: "重试、超时与流式保活",
    enTitle: "Retry, Timeout & Stream Keepalive",
    fields: [
      {
        key: "retry_attempts",
        type: "int",
        min: 1,
        max: 10,
        zhLabel: "最大尝试次数",
        enLabel: "Retry Attempts",
        zhHint: "含首次请求；流式已输出首字后不再重试 (1..10)",
        enHint: "Total attempts including initial try (1..10)"
      },
      {
        key: "retry_delay_sec",
        type: "int",
        min: 0,
        max: 60,
        zhLabel: "重试等待 (秒)",
        enLabel: "Retry Delay (sec)",
        zhHint: "两次重试之间的固定退避秒数 (0..60)",
        enHint: "Backoff seconds between retries (0..60)"
      },
      {
        key: "request_timeout_sec",
        type: "int",
        min: 5,
        max: 600,
        zhLabel: "上游超时 (秒)",
        enLabel: "Request Timeout (sec)",
        zhHint: "单次上游生成等待上限 (5..600)",
        enHint: "Upstream request timeout (5..600)"
      },
      {
        key: "stream_keepalive_sec",
        type: "int",
        min: 0,
        max: 300,
        zhLabel: "流式空闲保活 (秒)",
        enLabel: "Stream Keepalive (sec)",
        zhHint: "流式空闲发心跳防止 504；启用后首包锁定 HTTP 200 (0..300, 0=关闭)",
        enHint: "SSE heartbeat interval; locks HTTP 200 on stream start (0..300, 0=off)"
      },
      {
        key: "retry_on_timeout",
        type: "bool",
        zhLabel: "超时后继续重试",
        enLabel: "Retry On Timeout",
        zhHint: "开启：等满 request_timeout_sec 后仍按 retry_attempts 重试；关闭：超时立即报错",
        enHint: "Retry remaining attempts after request_timeout_sec elapses"
      },
      {
        key: "refusal_retry",
        type: "bool",
        zhLabel: "短拒答自动重试",
        enLabel: "Refusal Auto-Retry",
        zhHint: "检测到模板拒答时自动新建会话重试（非工具模型）",
        enHint: "Retry canned short refusals on a fresh session (non-tool models)"
      }
    ]
  },
  {
    id: "protocol",
    zhTitle: "协议、指纹与提示词限制",
    enTitle: "Protocol, Fingerprint & Prompt Limits",
    fields: [
      {
        key: "default_model",
        type: "model",
        required: true,
        zhLabel: "默认模型 (default_model)",
        enLabel: "Default Model",
        zhHint: "请求体未指定 model 时回落使用",
        enHint: "Fallback model when request omits model"
      },
      {
        key: "max_prompt_bytes",
        type: "int",
        min: 0,
        max: 1e7,
        zhLabel: "Prompt UTF-8 字节上限",
        enLabel: "Max Prompt Bytes",
        zhHint: "超限直接返回 400 避免上游静默截断 (0..10000000, 0=不限制)",
        enHint: "Reject oversized UTF-8 prompt before silent truncation (0..10000000, 0=off)"
      },
      {
        key: "impersonate",
        type: "text",
        required: true,
        datalist: "impersonateDatalist",
        zhLabel: "TLS 指纹预设 (impersonate)",
        enLabel: "TLS Impersonate Profile",
        zhHint: "直连浏览器 TLS 指纹（如 chrome_146, chrome_133, safari_18, firefox_147）",
        enHint: "Direct TLS client profile (chrome_146, chrome_133, chrome_131, safari_18, firefox_147)"
      },
      {
        key: "gemini_bl",
        type: "text",
        required: true,
        zhLabel: "Gemini 前端版本号 (gemini_bl)",
        enLabel: "Gemini Frontend BL (gemini_bl)",
        zhHint: "上游 boq_gemini-web-uiserver 版本字符串（不可为空）",
        enHint: "Upstream boq_gemini-web-uiserver build label (required)"
      },
      {
        key: "firefox_fingerprint",
        type: "bool",
        zhLabel: "Firefox / Zen 指纹模式 (实验)",
        enLabel: "Firefox Fingerprint (Experimental)",
        zhHint: "开启后直连强制走 Firefox_147 TLS 指纹与 Firefox 请求头（去 Sec-CH-UA）",
        enHint: "Force Firefox_147 TLS + Firefox UA headers (strips Sec-CH-UA)"
      },
      {
        key: "gemini_bl_auto",
        type: "bool",
        zhLabel: "自动刷新 gemini_bl",
        enLabel: "Auto-Refresh gemini_bl",
        zhHint: "定期从 /app 页面抓取最新 bl 版本号并动态覆盖",
        enHint: "Periodically fetch latest bl version from /app page"
      },
      {
        key: "web_channel",
        type: "bool",
        zhLabel: "新协议 WebChannel (processSession)",
        enLabel: "WebChannel Protocol (processSession)",
        zhHint: "对话改走新版 processSession 传输通道（多轮续接仍走 StreamGenerate）",
        enHint: "Route chat turns through processSession instead of legacy StreamGenerate"
      }
    ]
  },
  {
    id: "session",
    zhTitle: "会话、账号池与降级策略",
    enTitle: "Sessions, Accounts & Fallback Policy",
    fields: [
      {
        key: "strict_model_cooldown_min",
        type: "int",
        min: 0,
        max: 10080,
        zhLabel: "严格模型降级冷却 (分钟)",
        enLabel: "Strict Model Cooldown (min)",
        zhHint: "触发静默降级后该账号在此模型上的冷却分钟数 (0..10080, 0=不记录)",
        enHint: "Cooldown minutes per account/model after silent downgrade (0..10080)"
      },
      {
        key: "multi_turn",
        type: "bool",
        zhLabel: "服务端多轮续接 (multi_turn)",
        enLabel: "Server-Side Multi-Turn",
        zhHint: "按历史前缀复用 Gemini 原生会话 ID，绕开单请求字节墙",
        enHint: "Reuse Gemini conversation_id on matching history prefixes"
      },
      {
        key: "temporary_chat",
        type: "bool",
        zhLabel: "原生临时对话 (temporary_chat)",
        enLabel: "Temporary Chat (inner[45]=1)",
        zhHint: "不进入账号历史列表也不参与训练，可与 multi_turn 共用",
        enHint: "Use Gemini temporary chat mode (excluded from history/training)"
      },
      {
        key: "auto_delete_conversation",
        type: "bool",
        zhLabel: "出字后自动删除网页会话",
        enLabel: "Auto-Delete Conversation",
        zhHint: "登录态请求结束后异步清理远端会话记录",
        enHint: "Asynchronously delete upstream conversation after response completes"
      },
      {
        key: "anon_first",
        type: "bool",
        zhLabel: "无登录能力需求时匿名优先",
        enLabel: "Anonymous First",
        zhHint: "普通纯文本非思考无附件请求优先走匿名，节省 Cookie 配额",
        enHint: "Send eligible plain-text requests anonymously to conserve cookies"
      },
      {
        key: "image_upscale",
        type: "bool",
        zhLabel: "生图自动取放大原图",
        enLabel: "Image Upscale (Download Original)",
        zhHint: "出图后追加请求下载高清/2x 放大原图（失败则回退原图）",
        enHint: "Fetch upscaled/original image artifact via c8o8Fe RPC after generation"
      },
      {
        key: "strict_model",
        type: "bool",
        zhLabel: "严格模型校验 (strict_model)",
        enLabel: "Strict Model Check",
        zhHint: "上游自报模型不匹配时换号重试，全池降级则返回 429",
        enHint: "Retry another account on silent model downgrade; 429 if all downgraded"
      },
      {
        key: "fallback_direct",
        type: "bool",
        zhLabel: "代理耗尽时回落直连",
        enLabel: "Fallback Direct",
        zhHint: "代理池全部不可用时允许使用本机直连 IP（注意隐私暴露风险）",
        enHint: "Allow direct host egress when all proxy slots are unavailable"
      },
      {
        key: "fallback_anon",
        type: "bool",
        zhLabel: "Cookie 失效时降级匿名",
        enLabel: "Fallback Anonymous",
        zhHint: "Cookie 全部失败时降级匿名跑（高级模型/工具会被静默降级）",
        enHint: "Fall back to anonymous mode when cookies fail (capabilities degrade)"
      }
    ]
  },
  {
    id: "retention",
    zhTitle: "数据保留与日志",
    enTitle: "Retention & Logging",
    fields: [
      {
        key: "retention_days",
        type: "int",
        min: 1,
        max: 3650,
        zhLabel: "明细保留天数 (retention_days)",
        enLabel: "Retention Days",
        zhHint: "请求明细与审计包保留天数，聚合指标永久保存 (1..3650)",
        enHint: "Days to retain detailed request & audit records (1..3650)"
      },
      {
        key: "log_requests",
        type: "bool",
        zhLabel: "打印请求终端日志",
        enLabel: "Log Requests to Stdout",
        zhHint: "在服务端 stdout 输出请求摘要日志",
        enHint: "Emit per-request log lines on server stdout"
      }
    ]
  }
];
const ALL_RUNTIME_FIELDS = RUNTIME_GROUPS.flatMap((g) => g.fields);
const CONFIGURED_KEYS = new Set(ALL_RUNTIME_FIELDS.map((f) => f.key));
for (const key of Object.keys(RUNTIME_CONFIG_EXHAUSTIVE)) {
  if (!CONFIGURED_KEYS.has(key)) {
    throw new Error(`RuntimeConfig field "${key}" missing from RUNTIME_GROUPS`);
  }
}
function defaultRuntimeConfig() {
  return {
    retry_attempts: 3,
    retry_delay_sec: 2,
    request_timeout_sec: 180,
    default_model: "gemini-3.6-flash",
    per_ip_concurrent: 5,
    per_ip_rpm: 30,
    per_ip_rph: 80,
    retention_days: 30,
    log_requests: true,
    impersonate: "chrome_146",
    gemini_bl: "",
    proxy_cooldown_min: 120,
    fallback_direct: false,
    fallback_anon: false,
    gemini_bl_auto: true,
    max_prompt_bytes: 128000,
    multi_turn: false,
    auto_delete_conversation: false,
    anon_first: false,
    temporary_chat: false,
    image_upscale: false,
    web_channel: false,
    firefox_fingerprint: false,
    strict_model: false,
    strict_model_cooldown_min: 300,
    retry_on_timeout: true,
    stream_keepalive_sec: 0,
    refusal_retry: true
  };
}
function getGatewayBaseUrl() {
  return new URL("../", window.location.href).href.replace(/\/$/, "");
}
function buildProtocolSnippets(baseUrl, apiKey, model) {
  const key = apiKey || "YOUR_API_KEY";
  const m = model || "gemini-3.6-flash";
  return {
    openai_chat: {
      zhLabel: "OpenAI Chat Completions",
      enLabel: "OpenAI Chat Completions",
      endpoint: "POST /v1/chat/completions",
      code: `curl -X POST "${baseUrl}/v1/chat/completions" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        model: m,
        stream: false,
        messages: [{ role: "user", content: "Summarize the latest status concisely." }]
      }, null, 2)}'`
    },
    openai_responses: {
      zhLabel: "OpenAI Responses",
      enLabel: "OpenAI Responses",
      endpoint: "POST /v1/responses",
      code: `curl -X POST "${baseUrl}/v1/responses" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        model: m,
        instructions: "You are a concise engineering assistant.",
        input: "List three checks for gateway availability.",
        stream: false
      }, null, 2)}'`
    },
    anthropic: {
      zhLabel: "Anthropic Messages",
      enLabel: "Anthropic Messages",
      endpoint: "POST /v1/messages",
      code: `curl -X POST "${baseUrl}/v1/messages" \\
  -H "x-api-key: ${key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        model: m,
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello from Anthropic Messages API." }]
      }, null, 2)}'`
    },
    videos: {
      zhLabel: "OpenAI Sora Videos",
      enLabel: "OpenAI Sora Videos",
      endpoint: "POST /v1/videos + GET /v1/videos/{id}/content",
      code: `# 1) Create async video generation job
curl -X POST "${baseUrl}/v1/videos" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        model: "gemini-video",
        prompt: "A smooth sunrise timelapse over calm ocean cliffs",
        size: "1280x720"
      }, null, 2)}'

# 2) Poll job status (queued | in_progress | completed | failed)
curl "${baseUrl}/v1/videos/{id}" \\
  -H "Authorization: Bearer ${key}"

# 3) Download MP4 binary once completed
curl -L "${baseUrl}/v1/videos/{id}/content" \\
  -H "Authorization: Bearer ${key}" \\
  -o video.mp4`
    },
    gemini_native: {
      zhLabel: "Google Gemini Native",
      enLabel: "Google Gemini Native",
      endpoint: `POST /v1beta/models/${m}:generateContent`,
      code: `curl -X POST "${baseUrl}/v1beta/models/${encodeURIComponent(m)}:generateContent" \\
  -H "x-goog-api-key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Hello via native v1beta Gemini API." }] }],
        generationConfig: {
          thinkingConfig: { includeThoughts: true }
        }
      }, null, 2)}'`
    },
    mcp: {
      zhLabel: "MCP Streamable HTTP",
      enLabel: "MCP Streamable HTTP",
      endpoint: "POST /mcp",
      code: `# 1) List available MCP tools
curl -X POST "${baseUrl}/mcp" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2) Call a tool (e.g., web_search / generate_image / ask_gemini)
curl -X POST "${baseUrl}/mcp" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "web_search",
          arguments: { query: "gemini-web2api-go latest release" }
        }
      }, null, 2)}'

# Client config snippet (Claude Code / Cursor / MCP HTTP clients):
${JSON.stringify({
        mcpServers: {
          "gemini-gateway": {
            type: "http",
            url: `${baseUrl}/mcp`,
            headers: { Authorization: `Bearer ${key}` }
          }
        }
      }, null, 2)}`
    }
  };
}
export function mountConfig(container, ctx) {
  let lastLoadedConfig = null;
  let availableModels = [];
  let deployMeta = {};
  let apiKeyState = { key: "", locked: false };
  let keyVisible = false;
  let activeProtoTab = "openai_chat";
  let selectedProtoModel = "";
  async function loadAll() {
    try {
      const [cfgRes, keyRes] = await Promise.all([
        apiFetch("config"),
        apiFetch("apikey")
      ]);
      lastLoadedConfig = cfgRes.config;
      availableModels = Array.isArray(cfgRes.models) ? cfgRes.models.slice() : [];
      deployMeta = cfgRes.deploy ?? {};
      apiKeyState = {
        key: keyRes.key || "",
        locked: Boolean(keyRes.locked)
      };
      if (!selectedProtoModel || availableModels.length > 0 && !availableModels.includes(selectedProtoModel)) {
        selectedProtoModel = lastLoadedConfig.default_model || availableModels[0] || "gemini-3.6-flash";
      }
      ctx.updateShellCounts({ protocol: Boolean(lastLoadedConfig.web_channel) });
      render();
    } catch (err) {
      if (isApiError(err) && err.status === 401)
        return;
      toast(errMessage(err), "err");
    }
  }
  function renderRuntimeSection() {
    const cfg = lastLoadedConfig ?? defaultRuntimeConfig();
    const formError = uiAlert({ tone: "err", role: "alert", hidden: true });
    const form = el("form", { id: "runtimeConfigForm", class: "stack-md", novalidate: true });
    const impersonateList = el("datalist", { id: "impersonateDatalist" }, IMPERSONATE_SUGGESTIONS.map((s) => el("option", { value: s })));
    form.append(impersonateList);
    const modelOptions = availableModels.slice();
    if (cfg.default_model && !modelOptions.includes(cfg.default_model)) {
      modelOptions.unshift(cfg.default_model);
    }
    for (const group of RUNTIME_GROUPS) {
      const valueFields = group.fields.filter((f) => f.type !== "bool");
      const boolFields = group.fields.filter((f) => f.type === "bool");
      const body = el("div", { class: "panel__body panel__body--stack" });
      if (valueFields.length > 0) {
        const grid = el("div", { class: "form-grid" });
        for (const f of valueFields) {
          const inputId = `rt_${f.key}`;
          let control;
          if (f.type === "model") {
            const sel = el("select", { id: inputId, name: f.key });
            for (const m of modelOptions) {
              sel.append(el("option", { value: m }, m));
            }
            sel.value = cfg[f.key] || modelOptions[0] || "";
            control = sel;
          } else if (f.type === "int") {
            control = el("input", {
              id: inputId,
              name: f.key,
              type: "number",
              min: String(f.min),
              max: String(f.max),
              step: "1",
              value: String(cfg[f.key] ?? 0)
            });
          } else {
            control = el("input", {
              id: inputId,
              name: f.key,
              type: "text",
              value: String(cfg[f.key] ?? ""),
              list: f.datalist ?? false
            });
          }
          grid.append(uiField({
            label: bi(f.zhLabel, f.enLabel),
            forId: inputId,
            control,
            hint: bi(f.zhHint, f.enHint)
          }));
        }
        body.append(grid);
      }
      if (boolFields.length > 0) {
        const switchesWrap = el("div", { class: "form-grid" });
        for (const f of boolFields) {
          switchesWrap.append(uiSwitchRow({
            id: `rt_${f.key}`,
            name: f.key,
            title: bi(f.zhLabel, f.enLabel),
            desc: bi(f.zhHint, f.enHint),
            checked: Boolean(cfg[f.key])
          }));
        }
        body.append(switchesWrap);
      }
      const fieldset = el("fieldset", { class: "panel fieldset-panel" }, el("div", { class: "panel__head" }, el("legend", {}, bi(group.zhTitle, group.enTitle))), body);
      form.append(fieldset);
    }
    const makeResetBtn = () => uiButton({
      text: bi("重置表单", "Reset"),
      onClick: () => {
        render();
        toast(bi("已恢复到当前服务端配置", "Reset form to last loaded config"), "info", 2000);
      }
    });
    const saveTopBtn = uiButton({
      variant: "primary",
      i18n: "common.save",
      onClick: () => form.requestSubmit()
    });
    const saveBottomBtn = uiButton({
      type: "submit",
      variant: "primary",
      i18n: "common.save"
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setAlert(formError, "");
      const payload = { ...lastLoadedConfig ?? defaultRuntimeConfig() };
      for (const f of ALL_RUNTIME_FIELDS) {
        const elNode = form.elements.namedItem(f.key);
        if (!(elNode instanceof HTMLInputElement || elNode instanceof HTMLSelectElement))
          continue;
        if (f.type === "bool") {
          if (elNode instanceof HTMLInputElement) {
            payload[f.key] = Boolean(elNode.checked);
          }
        } else if (f.type === "int") {
          const raw = elNode.value.trim();
          const num = Number(raw);
          if (raw === "" || !Number.isInteger(num) || num < f.min || num > f.max) {
            setAlert(formError, bi(`${f.key} 必须是 [${f.min}, ${f.max}] 范围内的整数`, `${f.key} must be an integer between ${f.min} and ${f.max}`));
            elNode.focus();
            return;
          }
          payload[f.key] = num;
        } else {
          const val = elNode.value.trim();
          if (f.required && !val) {
            setAlert(formError, bi(`${f.key} 不能为空`, `${f.key} cannot be empty`));
            elNode.focus();
            return;
          }
          payload[f.key] = val;
        }
      }
      saveTopBtn.disabled = true;
      saveBottomBtn.disabled = true;
      try {
        const res = await apiFetch("config", {
          method: "PUT",
          body: payload
        });
        lastLoadedConfig = res.config || payload;
        ctx.updateShellCounts({ protocol: Boolean(lastLoadedConfig.web_channel) });
        toast(bi("运行时配置已保存并生效", "Runtime configuration saved and applied"), "ok");
        render();
      } catch (err) {
        const msg = errMessage(err);
        setAlert(formError, msg);
        toast(msg, "err");
      } finally {
        saveTopBtn.disabled = false;
        saveBottomBtn.disabled = false;
      }
    });
    form.append(el("div", { class: "row-actions cluster--end" }, makeResetBtn(), saveBottomBtn));
    return uiSectionPanel({
      id: "rtSection",
      titleId: "rtSectionHeading",
      title: bi("A. 运行时引擎参数 (28 项全量热生效)", "A. Runtime Engine Parameters (All 28 Fields)"),
      stack: true,
      actions: [makeResetBtn(), saveTopBtn],
      body: [formError, form]
    }).root;
  }
  function renderAccessAndDeploySection(onKeyUpdated) {
    const locked = apiKeyState.locked;
    const keyInput = el("input", {
      type: keyVisible ? "text" : "password",
      readonly: true,
      value: apiKeyState.key,
      "aria-label": "Gateway API Key",
      class: "mono input-flex"
    });
    const maskBtn = uiButton({
      text: keyVisible ? bi("隐藏", "Hide") : bi("显示", "Reveal"),
      onClick: () => {
        keyVisible = !keyVisible;
        keyInput.type = keyVisible ? "text" : "password";
        maskBtn.textContent = keyVisible ? bi("隐藏", "Hide") : bi("显示", "Reveal");
      }
    });
    const copyBtn = uiButton({
      text: bi("复制 Key", "Copy Key"),
      onClick: () => {
        copyText(apiKeyState.key, "API Key");
      }
    });
    const rotateBtn = uiButton({
      variant: "danger",
      disabled: locked,
      text: bi("轮换随机 Key", "Rotate Key"),
      onClick: async () => {
        const ok = await confirmDialog({
          title: bi("轮换网关 API Key", "Rotate Gateway API Key"),
          message: bi("生成新的随机 sk- 密钥后，旧密钥会立即失效。确认轮换？", "Generating a new random sk- key will immediately invalidate the current key. Continue?"),
          confirmText: bi("确认轮换", "Rotate Key"),
          danger: true
        });
        if (!ok)
          return;
        rotateBtn.disabled = true;
        try {
          const res = await apiFetch("apikey", { method: "POST" });
          apiKeyState.key = res.key || apiKeyState.key;
          apiKeyState.locked = Boolean(res.locked);
          toast(bi("API Key 已轮换", "API Key rotated"), "ok");
          onKeyUpdated();
        } catch (err) {
          toast(errMessage(err), "err");
        } finally {
          rotateBtn.disabled = apiKeyState.locked;
        }
      }
    });
    const customInput = el("input", {
      id: "customApiKeyInput",
      type: "text",
      placeholder: "sk-... (min 20 chars)",
      disabled: locked,
      class: "mono input-flex"
    });
    const applyCustomBtn = uiButton({
      type: "submit",
      variant: "primary",
      disabled: locked,
      text: bi("应用自定义 Key", "Apply Custom Key")
    });
    const customForm = el("form", {
      class: "form-row",
      onSubmit: async (e) => {
        e.preventDefault();
        const nextKey = customInput.value.trim();
        if (nextKey.length < 20) {
          toast(bi("自定义 Key 长度不能少于 20 位", "Custom key must be at least 20 characters"), "warn");
          customInput.focus();
          return;
        }
        applyCustomBtn.disabled = true;
        try {
          await apiFetch("apikey", {
            method: "PATCH",
            body: { key: nextKey }
          });
          apiKeyState.key = nextKey;
          customInput.value = "";
          toast(bi("自定义 API Key 已生效", "Custom API Key applied"), "ok");
          onKeyUpdated();
        } catch (err) {
          toast(errMessage(err), "err");
        } finally {
          applyCustomBtn.disabled = apiKeyState.locked;
        }
      }
    }, customInput, applyCustomBtn);
    const keyCard = uiSectionPanel({
      id: "apiKeySection",
      titleId: "apiKeyHeading",
      title: bi("B1. 网关 API 密钥 (Gateway API Key)", "B1. Gateway API Key"),
      headerExtra: [
        uiBadge(locked ? bi("已锁定 (--api-key / API_KEY)", "Locked (--api-key / API_KEY)") : bi("可动态轮换", "Mutable"), locked ? "warn" : "ok")
      ],
      stack: true,
      body: [
        locked ? uiAlert({
          tone: "warn",
          message: bi("当前 API Key 已被启动参数 --api-key 或环境变量 API_KEY 锁定，控制台轮换与修改已禁用。", "API key is locked by --api-key or API_KEY environment variable; rotation and overrides are disabled.")
        }) : null,
        el("div", { class: "form-row" }, keyInput, maskBtn, copyBtn, rotateBtn),
        uiField({
          label: bi("设置自定义 Key (PATCH api/apikey)", "Set Custom Key (PATCH api/apikey)"),
          forId: "customApiKeyInput",
          control: customForm
        })
      ]
    }).root;
    const d = deployMeta;
    const deployCard = uiSectionPanel({
      id: "deployInfoSection",
      titleId: "deployInfoHeading",
      title: bi("B2. 只读部署属性 (Deployment Info)", "B2. Deployment Metadata (Read-Only)"),
      headerExtra: [uiBadge("Startup Config")],
      body: [
        uiKeyValueGrid([
          { key: "deploy.host", value: d.host || "-" },
          { key: "deploy.port", value: d.port != null ? String(d.port) : "-" },
          { key: "deploy.db_path", value: d.db_path || "-" },
          { key: "deploy.cookie_file", value: d.cookie_file || bi("未配置 (Pool DB)", "Not set (Pool DB)") },
          {
            key: "deploy.admin_auth",
            value: uiBadge(d.admin_auth ? bi("已开启 Token 鉴权", "Enabled") : bi("未配置 Token", "Disabled"), d.admin_auth ? "ok" : "err")
          },
          {
            key: "deploy.api_key_locked",
            value: uiBadge(d.api_key_locked ? "true (Locked)" : "false (Mutable)", d.api_key_locked ? "warn" : "ok")
          }
        ])
      ]
    }).root;
    return el("div", { class: "grid-2" }, keyCard, deployCard);
  }
  function renderPlaygroundSection() {
    const baseUrl = getGatewayBaseUrl();
    const modelOptions = availableModels.slice();
    if (selectedProtoModel && !modelOptions.includes(selectedProtoModel)) {
      modelOptions.unshift(selectedProtoModel);
    }
    if (modelOptions.length === 0)
      modelOptions.push("gemini-3.6-flash");
    const modelSelect = el("select", { id: "playgroundModelSelect", "aria-label": bi("示例模型", "Snippet Model") }, modelOptions.map((m) => el("option", { value: m }, m)));
    modelSelect.value = selectedProtoModel || modelOptions[0];
    const section = uiSectionPanel({
      id: "playgroundSection",
      titleId: "playgroundHeading",
      title: bi("C. 多协议接入代码生成器 (Integration Playground)", "C. Multi-Protocol Integration Playground"),
      stack: true,
      actions: [
        uiBadge(baseUrl),
        el("label", { class: "sr-only", for: "playgroundModelSelect" }, bi("示例模型", "Snippet Model")),
        modelSelect
      ]
    });
    function renderTabsContent() {
      section.bodyEl.innerHTML = "";
      const snippets = buildProtocolSnippets(baseUrl, apiKeyState.key, modelSelect.value);
      const keys = Object.keys(snippets);
      const tabs = uiTabs({
        ariaLabel: bi("网关接入协议列表", "Gateway Protocols"),
        activeTab: activeProtoTab,
        tabs: keys.map((protoKey) => ({
          key: protoKey,
          id: `protoTab_${protoKey}`,
          panelId: `protoPanel_${protoKey}`,
          label: bi(snippets[protoKey].zhLabel, snippets[protoKey].enLabel)
        })),
        onSelect: (nextKey) => {
          activeProtoTab = nextKey;
        }
      });
      for (const protoKey of keys) {
        const spec = snippets[protoKey];
        const panelInner = tabs.panelBodies[protoKey];
        if (!panelInner)
          continue;
        panelInner.append(el("div", { class: "cluster cluster--between" }, uiBadge(spec.endpoint, "accent"), uiButton({
          size: "sm",
          text: bi("复制示例", "Copy Snippet"),
          onClick: () => {
            copyText(spec.code, spec.enLabel);
          }
        })), uiCodeBlock({
          code: spec.code,
          ariaLabel: `${spec.enLabel} (${spec.endpoint})`
        }));
        if (protoKey === "mcp") {
          panelInner.append(uiKeyValueGrid(MCP_TOOLS.map((tool) => ({
            key: tool.name,
            value: el("span", { class: "kv-item__v--prose" }, bi(tool.descZh, tool.descEn))
          }))));
        }
      }
      section.bodyEl.append(tabs.tablist, ...tabs.panelElements);
      tabs.controller.select(activeProtoTab);
    }
    modelSelect.addEventListener("change", () => {
      selectedProtoModel = modelSelect.value;
      renderTabsContent();
    });
    renderTabsContent();
    return section.root;
  }
  function render() {
    container.innerHTML = "";
    const header = uiPageHeader({
      titleI18n: "config.title",
      subtitleI18n: "config.subtitle",
      actions: [
        uiButton({
          i18n: "common.refresh",
          onClick: () => {
            loadAll();
          }
        })
      ]
    });
    let accessSlot;
    let playgroundSlot;
    const refreshAccessAndPlayground = () => {
      const nextAccess = renderAccessAndDeploySection(refreshAccessAndPlayground);
      const nextPlayground = renderPlaygroundSection();
      accessSlot.replaceWith(nextAccess);
      playgroundSlot.replaceWith(nextPlayground);
      accessSlot = nextAccess;
      playgroundSlot = nextPlayground;
    };
    const runtimeSection = renderRuntimeSection();
    accessSlot = renderAccessAndDeploySection(refreshAccessAndPlayground);
    playgroundSlot = renderPlaygroundSection();
    container.append(header.root, el("div", { class: "view-stack" }, runtimeSection, accessSlot, playgroundSlot));
  }
  loadAll();
  return { refresh: loadAll };
}
