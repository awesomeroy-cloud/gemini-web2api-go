// Strict TypeScript contracts mirroring Go backend structs across internal/app/.

export type Lang = 'zh' | 'en';

export type ViewName = 'overview' | 'traffic' | 'accounts' | 'egress' | 'models' | 'config';

export interface ShellCountsUpdate {
  accounts?: string | { active?: number; enabled?: number; total?: number };
  accountsEnabled?: number;
  accountsTotal?: number;
  proxies?: string | { active?: number; enabled?: number; total?: number };
  proxiesActive?: number;
  proxiesTotal?: number;
  version?: string;
  protocol?: boolean | string;
}

export interface ViewRefreshOptions {
  tab?: string;
  q?: string;
  model?: string;
  focusProbe?: boolean;
  refresh?: boolean;
}

export interface ViewContext {
  navigate: (view: ViewName, opts?: ViewRefreshOptions) => void;
  updateShellCounts: (counts: ShellCountsUpdate) => void;
}

export interface ViewController {
  refresh?: (opts?: ViewRefreshOptions) => void | Promise<void>;
  setSearchQuery?: (q: string) => void | Promise<void>;
}

// GET /
export interface RootHealthResponse {
  status: string;
  version: string;
  models: string[];
}

// GET /admin/api/stats?hours=24
export interface ModelStatRow {
  model: string;
  requests: number;
  success: number;
  avg_ms: number;
  prompt_tokens: number;
  output_tokens: number;
}

export interface ProxyStatRow {
  proxy: string;
  requests: number;
  success: number;
  avg_ms: number;
}

export interface ErrorBreakdownRow {
  kind: string;
  count: number;
  sample: string;
}

export interface StatsResponse {
  window_hours: number;
  total_requests: number;
  success: number;
  failures: number;
  success_rate: number;
  avg_ms: number;
  prompt_tokens: number;
  output_tokens: number;
  error_breakdown: ErrorBreakdownRow[] | null;
  by_model: ModelStatRow[] | null;
  by_proxy: ProxyStatRow[] | null;
}

// GET /admin/api/timeseries?range=24h|7d|30d
export type TimeseriesRange = '24h' | '7d' | '30d';
export type OverviewMetric = 'traffic' | 'latency' | 'tokens';

export interface TimeseriesPoint {
  bucket: number;
  requests: number;
  successes: number;
  p50_ms: number;
  p95_ms: number;
  prompt_tokens: number;
  output_tokens: number;
}

export interface TimeseriesResponse {
  range: TimeseriesRange;
  bucket_sec: number;
  series: TimeseriesPoint[] | null;
}

// GET /admin/api/audits, /admin/api/audits?models=1, /admin/api/audits/{id}
export interface AuditMediaSummary {
  req_count: number;
  res_count: number;
  total_count: number;
  req_types?: string[];
  res_types?: string[];
  total_bytes: number;
  human_size: string;
}

export interface AuditMediaItem {
  idx: number;
  side: 'req' | 'res';
  kind: 'image' | 'audio' | 'video' | 'file';
  mime: string;
  ext: string;
  bytes: number;
  human_size: string;
  source: string;
  url: string;
}

export interface AuditContentBlock {
  type: 'text' | 'image' | 'audio' | 'video' | 'tool_call' | 'tool_result' | 'thinking' | string;
  role?: string;
  text?: string;
  mime?: string;
  url?: string;
  name?: string;
  args?: string;
}

export interface AuditMCPInfo {
  method?: string;
  id?: string | number;
  tool_name?: string;
  arguments?: unknown;
  is_error?: boolean;
  content_types?: string[];
}

export interface AuditMetaItem {
  id: number;
  ts: number;
  client_ip: string;
  method: string;
  path: string;
  model: string;
  served_model: string;
  stream: number;
  status: number;
  failed: number;
  ttfb_ms: number;
  first_data_ms: number;
  total_ms: number;
  pings: number;
  prompt_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  tool_call_count: number;
  error_preview: string;
  request_preview: string;
  reply_preview: string;
  raw_bytes: number;
  raw_truncated: boolean;
  v: number;
  issue: string;
  finish_reason: string;
  resp_id: string;
  key_fp: string;
  account: string;
  proxy: string;
  attempts: number;
  upstream_ttfb_ms: number;
  upstream_ms: number;
  chunks: number;
  params_summary: string;
  user_agent: string;
  media_summary?: AuditMediaSummary | null;
}

export interface AuditFacetsResponse {
  models: string[];
  accounts: string[];
  issues: string[];
  finishes: string[];
  paths: string[];
  retention_days?: number;
  size_bytes?: number;
}

export interface AuditListResponse {
  items: AuditMetaItem[];
  has_more: boolean;
  next_before_id: number;
  total: number;
  has_older: boolean;
  has_newer: boolean;
  query_ms: number;
  retention_days: number;
  size_bytes: number;
}

export interface AuditDetailResponse extends AuditMetaItem {
  meta?: AuditMetaItem;
  error: string;
  content_type: string;
  query: string;
  req_headers: string;
  res_headers: string;
  params: string;
  system_prompt: string;
  tool_calls: string;
  reasoning: string;
  request_body: string;
  reply: string;
  raw: string;
  req_media: AuditMediaItem[];
  res_media: AuditMediaItem[];
  request_blocks: AuditContentBlock[];
  response_blocks: AuditContentBlock[];
  mcp_info?: AuditMCPInfo | null;
}

// GET /admin/api/requests
export interface RequestMetricRow {
  id: number;
  ts: number;
  model: string;
  upstream_model: string;
  proxy_id: number;
  proxy_name: string;
  account_id: number;
  account_label: string;
  status: number;
  error: string;
  ttfb_ms: number;
  total_ms: number;
  prompt_chars: number;
  response_chars: number;
  prompt_tokens: number;
  output_tokens: number;
  endpoint: string;
  stream: boolean;
}

export interface RequestsResponse {
  items: RequestMetricRow[] | null;
  total: number;
  limit: number;
  offset: number;
}

// GET/DELETE /admin/api/conversations
export interface ConvSessionView {
  key: string;
  cid: string;
  rid: string;
  rcid: string;
  turn: number;
  is_login: boolean;
  temp: boolean;
  account_id: number;
  authuser: string;
  proxy_id: number;
  updated_at: number;
  ttl_sec: number;
}

export interface ConversationsListResponse {
  items: ConvSessionView[];
  total: number;
}

export interface ConversationsDeleteResponse {
  ok: boolean;
  deleted: number;
}

// GET/POST/PATCH/DELETE /admin/api/cookies
export type CookieHealth = 'ok' | 'dead' | 'disabled' | 'unknown';
export type CookieStatus = 'enabled' | 'disabled';

export interface CookieAccountView {
  id: number;
  label: string;
  status: CookieStatus;
  health: CookieHealth;
  note: string;
  created_at: number;
  last_used_at: number;
  last_ok_at: number;
  last_error: string;
  fail_count: number;
  cookie_count: number;
  key_cookies: string[] | null;
  sapisid_tail: string;
  has_1psidts: boolean;
  proxy_id: number;
  proxy_name: string;
  authuser: number;
}

export interface CookiesListResponse {
  items: CookieAccountView[];
  total: number;
  enabled: number;
}

export interface CookieCheckResponse {
  ok: boolean;
  detail: string;
  proxy_name: string;
  took_ms: number;
}

export interface CookieRotateResponse {
  ok: boolean;
  detail: string;
  refreshed?: string[];
  next_sec?: number;
}

export interface CookieToggleResponse {
  status: CookieStatus;
}

export interface CookieCreateResponse {
  id: number;
}

// GET /admin/api/video-quota
export interface QuotaEvent {
  at: number;
  kind: 'video' | 'quota_refused' | 'policy_refused' | 'pending' | string;
  cid: string;
  title?: string;
  reset_at?: number;
}

export interface AccountVideoQuota {
  id: number;
  label: string;
  status: 'available' | 'exhausted' | 'error' | string;
  videos_last_5h: number;
  window_started_at?: number;
  last_video_at?: number;
  last_refusal_at?: number;
  reset_at?: number;
  reset_source?: 'google' | 'estimated' | string;
  error?: string;
  events?: QuotaEvent[];
}

export interface VideoQuotaResponse {
  now: number;
  window_seconds: number;
  accounts: AccountVideoQuota[] | null;
  note?: string;
  history_incomplete?: string;
}

// GET /admin/api/usage
export interface SlotUsageItem {
  proxy_id: number;
  name: string;
  inflight: number;
  rpm: number;
  rph: number;
  limit_concurrent: number;
  limit_rpm: number;
  limit_rph: number;
}

export interface UsageListResponse {
  items: SlotUsageItem[];
}

// GET/POST/PATCH/DELETE /admin/api/proxies
export interface ProxyItem {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  weight: number;
  fail_count: number;
  last_used: number;
  last_error: string;
  created_at: number;
}

export interface ProxiesListResponse {
  items: ProxyItem[] | null;
}

export interface ProxyCreateResponse {
  id: number;
}

export interface ProxyToggleResponse {
  enabled: boolean;
}

// GET /admin/api/test
export interface ProbeResult {
  ok: boolean;
  status: string;
  http_code: number;
  total_ms: number;
  proxy_id: number;
  proxy_name: string;
  use_direct: boolean;
  response_text: string;
  upstream_snip: string;
  diagnostic: string;
  impersonate: string;
}

// GET/PUT /admin/api/models
export interface ModelConfig {
  alias_of?: string;
  hex_id?: string;
  mode?: number;
  desc?: string;
  thinking?: boolean;
  think_wire?: number;
  tool?: number;
  upstream?: string;
  video_aspect?: number;
}

export interface ModelsResponse {
  ok?: boolean;
  path: string;
  models: Record<string, ModelConfig>;
  mtime: number;
}

// GET/PUT /admin/api/config (all 28 RuntimeConfig fields)
export interface RuntimeConfig {
  retry_attempts: number;
  retry_delay_sec: number;
  request_timeout_sec: number;
  default_model: string;
  per_ip_concurrent: number;
  per_ip_rpm: number;
  per_ip_rph: number;
  retention_days: number;
  log_requests: boolean;
  impersonate: string;
  gemini_bl: string;
  proxy_cooldown_min: number;
  fallback_direct: boolean;
  fallback_anon: boolean;
  gemini_bl_auto: boolean;
  max_prompt_bytes: number;
  multi_turn: boolean;
  auto_delete_conversation: boolean;
  anon_first: boolean;
  temporary_chat: boolean;
  image_upscale: boolean;
  web_channel: boolean;
  firefox_fingerprint: boolean;
  strict_model: boolean;
  strict_model_cooldown_min: number;
  retry_on_timeout: boolean;
  stream_keepalive_sec: number;
  refusal_retry: boolean;
}

export interface DeployMeta {
  host: string;
  port: number;
  db_path: string;
  cookie_file: string;
  admin_auth: boolean;
  api_key_locked: boolean;
}

export interface AdminConfigResponse {
  config: RuntimeConfig;
  models: string[];
  deploy: DeployMeta;
}

export interface AdminConfigSaveResponse {
  ok: boolean;
  config: RuntimeConfig;
}

// GET/POST/PATCH /admin/api/apikey
export interface ApiKeyResponse {
  key: string;
  locked: boolean;
}

export interface OkResponse {
  ok: boolean;
}
