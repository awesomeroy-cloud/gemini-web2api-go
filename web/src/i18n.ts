// Bilingual dictionary (zh / en) and typed translation helpers.

import type { Lang } from './types.ts';

const DICT = {
  zh: {
    'brand.title': 'GEMINI GATEWAY',
    'brand.sub': 'CONTROL PLANE',
    'nav.overview': '指挥总览',
    'nav.traffic': '流量与审计',
    'nav.accounts': '账号池与视频配额',
    'nav.egress': '出口代理与限流',
    'nav.models': '模型注册表',
    'nav.config': '引擎配置与接入',
    'header.search_placeholder': '按审计关键词/模型/Trace ID 快速跳转…',
    'header.probe_btn': '快速探针',
    'header.refresh_btn': '刷新',
    'header.theme_toggle': '切换明暗主题',
    'header.lang_toggle': '中 / EN',
    'header.logout': '退出登录',
    'header.menu_toggle': '切换导航菜单',
    'auth.title': '管理控制台认证',
    'auth.desc': '输入启动参数 --admin-token 或环境变量 ADMIN_TOKEN 配置的管理员令牌。',
    'auth.token_label': '管理员令牌 (Admin Token)',
    'auth.submit': '解锁控制台',
    'common.confirm': '确认',
    'common.cancel': '取消',
    'common.save': '保存并生效',
    'common.create': '创建',
    'common.edit': '编辑',
    'common.delete': '删除',
    'common.close': '关闭',
    'common.refresh': '刷新',
    'common.empty': '暂无记录',
    'common.loading': '加载中…',
    'common.copied': '已复制',
    'common.copy_fail': '复制失败，请手动复制',
    'common.enabled': '已启用',
    'common.disabled': '已停用',
    'common.all': '全部',
    'overview.title': '运行指挥总览',
    'overview.subtitle': '最近 24 小时网关吞吐、延迟分位、令牌消耗与健康分布',
    'overview.kpi.requests': '24h 请求总量',
    'overview.kpi.success': '成功率',
    'overview.kpi.latency': '平均响应耗时',
    'overview.kpi.tokens': '令牌总吞吐',
    'overview.kpi.accounts': '可用账号池',
    'overview.kpi.egress': '可用出口槽',
    'overview.chart.title': '时序遥测曲线',
    'overview.chart.metric_traffic': '请求与成功量',
    'overview.chart.metric_latency': 'P50 / P95 延迟 (ms)',
    'overview.chart.metric_tokens': '输入 / 输出令牌',
    'overview.models.title': '按模型统计 (24h)',
    'overview.proxies.title': '按出口统计 (24h)',
    'overview.errors.title': '错误归因分布 (24h)',
    'traffic.title': '流量、审计与多轮会话',
    'traffic.subtitle': '全量请求审计包解析、轻量指标流水、以及内存级多轮会话状态',
    'traffic.tab.audits': '全量审计日志',
    'traffic.tab.requests': '轻量请求指标',
    'traffic.tab.sessions': '活跃多轮会话',
    'accounts.title': '账号池与 5h 视频配额',
    'accounts.subtitle': 'Google Cookie 登录态健康检查、保活轮换与 Veo 视频真实历史配额核查',
    'accounts.tab.cookies': 'Cookie 账号池',
    'accounts.tab.video': '5h 视频配额诊断',
    'egress.title': '出口代理、IP 限流与连通探针',
    'egress.subtitle': '实时并发 / RPM / RPH 水位（对标 Google 80 RPH 封禁红线）、代理权重池管理与端到端 TLS 诊断',
    'models.title': '模型注册表与热重载',
    'models.subtitle': '可视化维护 models.json 模型映射、思考档线值与工具通道，支持原子热更新',
    'config.title': '运行时引擎、密钥与多协议接入',
    'config.subtitle': '全量 28 项运行时动态参数、API 密钥管理、只读部署属性及六大协议代码生成器',
  },
  en: {
    'brand.title': 'GEMINI GATEWAY',
    'brand.sub': 'CONTROL PLANE',
    'nav.overview': 'Command Center',
    'nav.traffic': 'Traffic & Audits',
    'nav.accounts': 'Accounts & Video Quota',
    'nav.egress': 'Egress & Rate Limits',
    'nav.models': 'Model Registry',
    'nav.config': 'Engine & Gateway',
    'header.search_placeholder': 'Jump to audits by keyword / model / id…',
    'header.probe_btn': 'E2E Probe',
    'header.refresh_btn': 'Refresh',
    'header.theme_toggle': 'Toggle color scheme',
    'header.lang_toggle': 'ZH / EN',
    'header.logout': 'Sign out',
    'header.menu_toggle': 'Toggle navigation',
    'auth.title': 'Admin Authentication',
    'auth.desc': 'Enter the admin token configured via --admin-token or ADMIN_TOKEN.',
    'auth.token_label': 'Admin Token',
    'auth.submit': 'Unlock Console',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.save': 'Save & Apply',
    'common.create': 'Create',
    'common.edit': 'Edit',
    'common.delete': 'Delete',
    'common.close': 'Close',
    'common.refresh': 'Refresh',
    'common.empty': 'No records found',
    'common.loading': 'Loading…',
    'common.copied': 'Copied',
    'common.copy_fail': 'Copy failed',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'common.all': 'All',
    'overview.title': 'Command Center',
    'overview.subtitle': '24h gateway throughput, latency percentiles, token volume, and pool availability',
    'overview.kpi.requests': 'Requests (24h)',
    'overview.kpi.success': 'Success Rate',
    'overview.kpi.latency': 'Avg Latency',
    'overview.kpi.tokens': 'Token Volume',
    'overview.kpi.accounts': 'Cookie Pool',
    'overview.kpi.egress': 'Egress Slots',
    'overview.chart.title': 'Telemetry Time Series',
    'overview.chart.metric_traffic': 'Requests & Successes',
    'overview.chart.metric_latency': 'P50 / P95 Latency (ms)',
    'overview.chart.metric_tokens': 'Prompt / Output Tokens',
    'overview.models.title': 'By Model (24h)',
    'overview.proxies.title': 'By Egress (24h)',
    'overview.errors.title': 'Error Breakdown (24h)',
    'traffic.title': 'Traffic, Audits & Sessions',
    'traffic.subtitle': 'Full HTTP/MCP audit payload inspector, lightweight request ledger, and active multi-turn sessions',
    'traffic.tab.audits': 'Full Audit Log',
    'traffic.tab.requests': 'Request Metrics',
    'traffic.tab.sessions': 'Active Sessions',
    'accounts.title': 'Account Pool & 5h Video Quota',
    'accounts.subtitle': 'Cookie authentication health checks, PSIDTS keepalive rotation, and live Veo history quota',
    'accounts.tab.cookies': 'Cookie Pool',
    'accounts.tab.video': '5h Video Quota',
    'egress.title': 'Egress Pool, Rate Limits & Probe',
    'egress.subtitle': 'Live slot concurrency / RPM / RPH gauges (80 RPH Google ban threshold), proxy pool CRUD, and TLS probe',
    'models.title': 'Model Registry & Hot-Reload',
    'models.subtitle': 'Visual and JSON editor for models.json (hex_id, mode, thinking, tools, aliases) with atomic hot-reload',
    'config.title': 'Runtime Engine, API Key & Protocols',
    'config.subtitle': 'All 28 RuntimeConfig parameters, API key management, deployment metadata, and 6-protocol snippet generator',
  },
} as const;

export type DictKey = keyof typeof DICT.zh;

let currentLang: Lang = (() => {
  try {
    const saved = localStorage.getItem('admin_lang');
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
})();

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang === 'en' ? 'en' : 'zh';
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  try {
    localStorage.setItem('admin_lang', currentLang);
  } catch {
    // Ignore storage access errors
  }
  applyI18n(document);
}

export function isZh(): boolean {
  return currentLang === 'zh';
}

export function bi(zhText: string, enText: string): string {
  return currentLang === 'zh' ? zhText : enText;
}

export function t(key: DictKey | (string & {}), vars?: Record<string, string | number> | null): string {
  const dict = DICT[currentLang] as Record<string, string>;
  const fallback = DICT.zh as Record<string, string>;
  let str = dict[key] ?? fallback[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function applyI18n(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const k = node.getAttribute('data-i18n');
    if (k) node.textContent = t(k);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    const k = node.getAttribute('data-i18n-placeholder');
    if (k) node.setAttribute('placeholder', t(k));
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const k = node.getAttribute('data-i18n-aria');
    if (k) node.setAttribute('aria-label', t(k));
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-bi-zh]')) {
    const zh = node.dataset.biZh ?? '';
    const en = node.dataset.biEn ?? zh;
    node.textContent = bi(zh, en);
  }
}
