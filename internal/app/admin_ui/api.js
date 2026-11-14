// Auto-generated from web/src/api.ts via `bun run web/build.ts`. Do not edit directly.
import { t } from "./i18n.js";

export class ApiError extends Error {
  status;
  data;
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}
let onUnauthorizedCb = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorizedCb = fn;
}
export function isApiError(err) {
  return err instanceof ApiError || typeof err === "object" && err !== null && "status" in err;
}
export function errMessage(err, fallback = "Request failed") {
  if (err instanceof Error && err.message)
    return err.message;
  if (typeof err === "string" && err)
    return err;
  return fallback;
}
export async function rawFetch(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...opts
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.status === 401) {
    if (onUnauthorizedCb)
      onUnauthorizedCb();
    const errObj = data;
    throw new ApiError(errObj && errObj.error || "Unauthorized", 401, data);
  }
  if (!res.ok) {
    const errObj = data;
    const msg = errObj && typeof errObj === "object" && (errObj.error || errObj.message) || typeof data === "string" && data || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data;
}
export function apiFetch(relPath, opts = {}) {
  const clean = relPath.replace(/^\/+/, "");
  const headers = {
    ...opts.headers ?? {}
  };
  let bodyPayload;
  if (opts.body !== undefined && opts.body !== null) {
    if (typeof opts.body === "object" && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && !(opts.body instanceof URLSearchParams)) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(opts.body);
    } else {
      bodyPayload = opts.body;
    }
  }
  return rawFetch(`api/${clean}`, { ...opts, headers, body: bodyPayload });
}
export function rootFetch(relPath, opts = {}) {
  const clean = relPath.replace(/^\/+/, "");
  return rawFetch(`../${clean}`, opts);
}
export function fmtNum(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString() : "0";
}
export function fmtBytes(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0)
    return "0 B";
  if (v >= 1024 ** 3)
    return `${(v / 1024 ** 3).toFixed(2)} GiB`;
  if (v >= 1024 ** 2)
    return `${(v / 1024 ** 2).toFixed(2)} MiB`;
  if (v >= 1024)
    return `${(v / 1024).toFixed(1)} KiB`;
  return `${v} B`;
}
export function fmtMs(ms) {
  const v = Number(ms ?? 0);
  if (!Number.isFinite(v) || v <= 0)
    return "0 ms";
  if (v >= 1000)
    return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec ?? 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const r = s % 60;
  if (h > 0)
    return `${h}h ${m}m`;
  if (m > 0)
    return `${m}m ${r}s`;
  return `${r}s`;
}
export function fmtTime(unixSec) {
  const n = Number(unixSec ?? 0);
  if (!n)
    return "-";
  const d = new Date(n * 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function fmtRel(unixSec) {
  const n = Number(unixSec ?? 0);
  if (!n)
    return "-";
  const diff = Math.round(Date.now() / 1000 - n);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60)
    return `${abs}s ${suffix}`;
  if (abs < 3600)
    return `${Math.floor(abs / 60)}m ${suffix}`;
  if (abs < 86400)
    return `${Math.floor(abs / 3600)}h ${suffix}`;
  return `${Math.floor(abs / 86400)}d ${suffix}`;
}
export async function copyTextWithToast(str, label, onToast) {
  try {
    await navigator.clipboard.writeText(str);
    onToast(label ? `${t("common.copied")}: ${label}` : t("common.copied"), "ok", 2000);
  } catch {
    onToast(t("common.copy_fail"), "err");
  }
}
