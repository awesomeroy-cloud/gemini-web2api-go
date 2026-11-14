// Typed API client and telemetry formatters.

import { t } from './i18n.ts';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

let onUnauthorizedCb: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorizedCb = fn;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError || (typeof err === 'object' && err !== null && 'status' in err);
}

export function errMessage(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

export async function rawFetch<T = unknown>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...opts,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.status === 401) {
    if (onUnauthorizedCb) onUnauthorizedCb();
    const errObj = data as { error?: string } | null;
    throw new ApiError((errObj && errObj.error) || 'Unauthorized', 401, data);
  }
  if (!res.ok) {
    const errObj = data as { error?: string; message?: string } | null;
    const msg =
      (errObj && typeof errObj === 'object' && (errObj.error || errObj.message)) ||
      (typeof data === 'string' && data) ||
      `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export function apiFetch<T = unknown>(relPath: string, opts: ApiFetchOptions = {}): Promise<T> {
  const clean = relPath.replace(/^\/+/, '');
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string> | undefined) ?? {}),
  };
  let bodyPayload: BodyInit | undefined;
  if (opts.body !== undefined && opts.body !== null) {
    if (typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && !(opts.body instanceof URLSearchParams)) {
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(opts.body);
    } else {
      bodyPayload = opts.body as BodyInit;
    }
  }
  return rawFetch<T>(`api/${clean}`, { ...opts, headers, body: bodyPayload });
}

export function rootFetch<T = unknown>(relPath: string, opts: RequestInit = {}): Promise<T> {
  const clean = relPath.replace(/^\/+/, '');
  return rawFetch<T>(`../${clean}`, opts);
}

export function fmtNum(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toLocaleString() : '0';
}

export function fmtBytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GiB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(2)} MiB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KiB`;
  return `${v} B`;
}

export function fmtMs(ms: number | null | undefined): string {
  const v = Number(ms ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0 ms';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
}

export function fmtDuration(sec: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(sec ?? 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

export function fmtTime(unixSec: number | null | undefined): string {
  const n = Number(unixSec ?? 0);
  if (!n) return '-';
  const d = new Date(n * 1000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtRel(unixSec: number | null | undefined): string {
  const n = Number(unixSec ?? 0);
  if (!n) return '-';
  const diff = Math.round(Date.now() / 1000 - n);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 60) return `${abs}s ${suffix}`;
  if (abs < 3600) return `${Math.floor(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.floor(abs / 3600)}h ${suffix}`;
  return `${Math.floor(abs / 86400)}d ${suffix}`;
}

export async function copyTextWithToast(
  str: string,
  label: string | undefined,
  onToast: (msg: string, kind: 'ok' | 'err', ms?: number) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(str);
    onToast(label ? `${t('common.copied')}: ${label}` : t('common.copied'), 'ok', 2000);
  } catch {
    onToast(t('common.copy_fail'), 'err');
  }
}
