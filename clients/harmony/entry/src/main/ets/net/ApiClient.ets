// Network layer N1–N7 (parent design.md §2.1), isomorphic with Android ApiClient.
// Single choke point for every `/api/v1/...` call: baseURL config, session
// cookie, CSRF header, error mapping.
//
// Rules enforced here (do NOT re-implement per repository):
// - N1: baseURL is user-configured + remembered (Preferences), never hardcoded.
// - N2: session cookie `jizhang_session` persisted; cleared on logout.
// - N3: every mutating request carries `X-Requested-With: fetch` (login included).
// - N4: bodiless POST sends NO `Content-Type` (Fastify 400s otherwise).
// - N5: non-2xx becomes ApiError carrying the server `{error:{code,message}}`;
//   HTTP 401 surfaces as `code === 'UNAUTHORIZED'` so UI returns to login.
// - N6: online-first — callers check connectivity before writes; responses are
//   never cached (usingCache=false; server answers `no-store`).
// - N7: exports/backups download through `download` with the session cookie;
//   there is NO restore endpoint (CLI only) — show the command, don't invent one.

import http from '@ohos.net.http';
import preferences from '@ohos.data.preferences';
import util from '@ohos.util';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { UIAbility } from '@kit.AbilityKit';

const PREFS_NAME = 'jizhang';
const BASE_URL_KEY = 'server_base_url';
const COOKIE_KEY = 'session_cookie';

export class ApiError extends Error {
  status: number = 0;
  code: string = '';
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export class OfflineError extends Error {
  constructor(message: string = '需要联网才能记账。') {
    super(message);
    this.name = 'OfflineError';
  }
}

let prefs: preferences.Preferences | undefined = undefined;
let abilityContext: UIAbility | undefined = undefined;

/** Called once from EntryAbility.onCreate so Preferences has a context. */
export function initApiContext(ctx: UIAbility): void {
  abilityContext = ctx;
}

async function getPrefs(): Promise<preferences.Preferences> {
  if (!prefs) {
    const store = abilityContext?.context;
    if (!store) {
      throw new Error('ApiClient 未初始化（EntryAbility 未调用 initApiContext）');
    }
    prefs = await preferences.getPreferences(store, PREFS_NAME);
  }
  return prefs as preferences.Preferences;
}

export async function getBaseUrl(): Promise<string> {
  const p = await getPrefs();
  const v = await p.get(BASE_URL_KEY, '');
  return v as string;
}

export async function setBaseUrl(url: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    throw new Error('服务端地址须以 http(s):// 开头');
  }
  const p = await getPrefs();
  await p.put(BASE_URL_KEY, normalized);
  await p.flush();
}

async function requireBaseUrl(): Promise<string> {
  const base = await getBaseUrl();
  if (!base) {
    throw new Error('请先填写服务端地址');
  }
  return base;
}

async function getCookie(): Promise<string> {
  const p = await getPrefs();
  return (await p.get(COOKIE_KEY, '')) as string;
}

async function saveCookie(setCookie: string): Promise<void> {
  // Keep the `name=value` pair (drop attributes); single-session app.
  const pair = setCookie.split(';')[0]?.trim() ?? '';
  if (!pair) {
    return;
  }
  const p = await getPrefs();
  await p.put(COOKIE_KEY, pair);
  await p.flush();
}

export async function clearSession(): Promise<void> {
  const p = await getPrefs();
  await p.delete(COOKIE_KEY);
  await p.flush();
}

function utf8Bytes(text: string): ArrayBuffer {
  const u8: Uint8Array = new util.TextEncoder().encodeInto(text);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function looksLikeUrl(candidate: string): boolean {
  const t = candidate.trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

function toApiError(status: number, text: string): ApiError {
  let code: string = 'REQUEST_ERROR';
  let message: string = `请求失败（${status}）`;
  try {
    const parsed: ESObject = JSON.parse(text);
    const err: ESObject = parsed?.error as ESObject;
    if (err !== null && err !== undefined) {
      const c: ESObject = err?.code as ESObject;
      if (typeof c === 'string' && c.length > 0) {
        code = c;
      }
      const m: ESObject = err?.message as ESObject;
      if (typeof m === 'string' && m.length > 0) {
        message = m;
      }
    }
  } catch (e) {
    hilog.error(0x0000, 'jizhang', 'error body parse failed: %{public}s', String(e));
  }
  return new ApiError(status, code, message);
}

export interface RawBody {
  contentType: string;
  bytes: ArrayBuffer;
}

/** Typed query params (named optional fields — no index signature, ArkTS §10605017). */
export interface ApiQuery {
  from?: string;
  to?: string;
  limit?: string;
  months?: string;
  periodStart?: string;
  includeDeleted?: string;
  status?: string;
  q?: string;
  type?: string;
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: ApiQuery;
  /** JSON body. Absent + mutating => bodiless (N4: no Content-Type). */
  body?: ESObject;
  /** Raw bytes body with explicit content type (xlsx/GBK/photos/CSV text). */
  rawBody?: RawBody;
}

export async function call(path: string, options: CallOptions = {}): Promise<string> {
  const base = await requireBaseUrl();
  const method = options.method ?? 'GET';
  const mutating = method !== 'GET';

  let url = base + path;
  if (options.query) {
    const parts: string[] = [];
    const qq: ApiQuery = options.query;
    if (qq.from !== undefined && qq.from !== '') {
      parts.push(`from=${encodeURIComponent(qq.from)}`);
    }
    if (qq.to !== undefined && qq.to !== '') {
      parts.push(`to=${encodeURIComponent(qq.to)}`);
    }
    if (qq.limit !== undefined && qq.limit !== '') {
      parts.push(`limit=${encodeURIComponent(qq.limit)}`);
    }
    if (qq.months !== undefined && qq.months !== '') {
      parts.push(`months=${encodeURIComponent(qq.months)}`);
    }
    if (qq.periodStart !== undefined && qq.periodStart !== '') {
      parts.push(`periodStart=${encodeURIComponent(qq.periodStart)}`);
    }
    if (qq.includeDeleted !== undefined && qq.includeDeleted !== '') {
      parts.push(`includeDeleted=${encodeURIComponent(qq.includeDeleted)}`);
    }
    if (qq.status !== undefined && qq.status !== '') {
      parts.push(`status=${encodeURIComponent(qq.status)}`);
    }
    if (qq.q !== undefined && qq.q !== '') {
      parts.push(`q=${encodeURIComponent(qq.q)}`);
    }
    if (qq.type !== undefined && qq.type !== '') {
      parts.push(`type=${encodeURIComponent(qq.type)}`);
    }
    if (parts.length > 0) {
      url += (url.includes('?') ? '&' : '?') + parts.join('&');
    }
  }

  const session = await getCookie();
  const req = http.createHttp();
  try {
    const headers: Record<string, string> = {};
    if (session) {
      headers['Cookie'] = session;
    }
    if (mutating) {
      // N3: CSRF second layer (login included).
      headers['X-Requested-With'] = 'fetch';
    }
    let extraData: string | ArrayBuffer | undefined = undefined;
    if (options.rawBody) {
      headers['Content-Type'] = options.rawBody.contentType;
      extraData = options.rawBody.bytes;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      extraData = JSON.stringify(options.body);
    }
    // N4: bodiless mutating request sends NO Content-Type — extraData stays undefined.

    const requestOptions: http.HttpRequestOptions = {
      method: method as http.RequestMethod,
      header: headers,
      connectTimeout: 15000,
      readTimeout: 30000,
      usingCache: false,
    };
    if (extraData !== undefined) {
      requestOptions.extraData = extraData;
    }
    const resp = await req.request(url, requestOptions);
    if (resp.cookies) {
      await saveCookie(resp.cookies);
    }
    const code = resp.responseCode ?? 0;
    const bodyText = (resp.result as string) ?? '';
    if (code === 401) {
      throw toApiError(401, bodyText);
    }
    if (code < 200 || code >= 300) {
      throw toApiError(code, bodyText);
    }
    return bodyText;
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }
    hilog.error(0x0000, 'jizhang', 'request failed: %{public}s', String(e));
    throw new Error('request failed: ' + String(e));
  } finally {
    req.destroy();
  }
}

/** File download with the session cookie (N7). Returns raw bytes. */
export async function download(url: string): Promise<ArrayBuffer> {
  const base = await requireBaseUrl();
  const full = url.startsWith('/') ? base + url : url;
  const session = await getCookie();
  const req = http.createHttp();
  try {
    const headers: Record<string, string> = {};
    if (session) {
      headers['Cookie'] = session;
    }
    const resp = await req.request(full, {
      method: http.RequestMethod.GET,
      header: headers,
      connectTimeout: 15000,
      readTimeout: 60000,
      usingCache: false,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
    });
    const code = resp.responseCode ?? 0;
    if (code === 401) {
      throw new ApiError(401, 'UNAUTHORIZED', '登录已过期，请重新登录。');
    }
    if (code < 200 || code >= 300) {
      throw toApiError(code, (resp.result as string) ?? '');
    }
    const result = resp.result;
    if (typeof result === 'string') {
      return utf8Bytes(result);
    }
    return result as ArrayBuffer;
  } finally {
    req.destroy();
  }
}
