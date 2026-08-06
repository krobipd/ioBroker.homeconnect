// Thin fetch-based HTTP for the Home Connect API. Node 22 global `fetch` +
// `AbortSignal.timeout` — no extra dependency, no manual timer to leak. The REST
// (GET/PUT with a bearer token) layer is added on top of this when devices are
// fetched; for now it provides the OAuth token-endpoint transport.

import type { FormPostResult } from "./oauth";

/** Default per-request timeout (Home Connect research pins request timeout at 20 s). */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * POST an `application/x-www-form-urlencoded` body and return status + parsed JSON.
 * Used for the OAuth token endpoints. A network error or timeout maps to a
 * non-ok result (status 0) rather than throwing, so the auth layer treats
 * transport failures and HTTP errors uniformly.
 *
 * @param baseUrl the region base URL, e.g. "https://api.home-connect.com"
 * @param path the endpoint path, e.g. "/security/oauth/token"
 * @param form the form fields to url-encode
 * @param timeoutMs abort the request after this many ms
 * @returns the HTTP status, ok flag and parsed JSON body (null if none/invalid)
 */
export async function postForm(
  baseUrl: string,
  path: string,
  form: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<FormPostResult> {
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 0, ok: false, body: { error: "network_error", error_description: String(e) } };
  }
  return { status: res.status, ok: res.ok, body: await parseJsonBody(res) };
}

/** Result of a JSON GET: status, ok, the unwrapped `data`, and a BSH error key on failure. */
export interface JsonResult {
  /** HTTP status code (0 on a transport error). */
  status: number;
  /** Whether the status is 2xx. */
  ok: boolean;
  /** The unwrapped `data` field of the `{ data: … }` envelope, or undefined on failure. */
  data: unknown;
  /** The BSH `error.key` (or a status string) on failure, else undefined. */
  error: string | undefined;
}

/**
 * GET a Home Connect JSON resource with a bearer token. Unwraps the `{ data: … }`
 * envelope and surfaces the BSH `error.key` on failure. A network error or timeout
 * maps to status 0.
 *
 * @param baseUrl the region base URL
 * @param path the endpoint path, e.g. "/api/homeappliances"
 * @param accessToken the OAuth bearer access token
 * @param acceptLanguage optional Accept-Language for localized names
 * @param timeoutMs abort the request after this many ms
 * @returns status, ok, unwrapped data and (on failure) the error key
 */
export async function getJson(
  baseUrl: string,
  path: string,
  accessToken: string,
  acceptLanguage?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<JsonResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.bsh.sdk.v1+json",
  };
  if (acceptLanguage) {
    headers["accept-language"] = acceptLanguage;
  }
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { status: 0, ok: false, data: undefined, error: `network_error: ${String(e)}` };
  }
  return toJsonResult(res);
}

/**
 * PUT a `{ data }` body (a Home Connect write: setting, program, option, command)
 * with a bearer token.
 *
 * @param baseUrl the region base URL
 * @param path the endpoint path
 * @param accessToken the OAuth bearer access token
 * @param data the value to wrap as `{ data }`
 * @param timeoutMs abort the request after this many ms
 * @returns status, ok and (on failure) the error key
 */
export async function putJson(
  baseUrl: string,
  path: string,
  accessToken: string,
  data: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<JsonResult> {
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/vnd.bsh.sdk.v1+json",
      },
      body: JSON.stringify({ data }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 0, ok: false, data: undefined, error: `network_error: ${String(e)}` };
  }
  return toJsonResult(res);
}

/**
 * DELETE a Home Connect resource (e.g. stop the active program) with a bearer token.
 *
 * @param baseUrl the region base URL
 * @param path the endpoint path
 * @param accessToken the OAuth bearer access token
 * @param timeoutMs abort the request after this many ms
 * @returns status, ok and (on failure) the error key
 */
export async function deleteJson(
  baseUrl: string,
  path: string,
  accessToken: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<JsonResult> {
  let res: Response;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.bsh.sdk.v1+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { status: 0, ok: false, data: undefined, error: `network_error: ${String(e)}` };
  }
  return toJsonResult(res);
}

/**
 * Turn a fetch Response into a {@link JsonResult}: unwrap the `{ data }` envelope
 * and surface the BSH error key on failure.
 *
 * @param res the fetch Response
 * @returns the normalized JSON result
 */
async function toJsonResult(res: Response): Promise<JsonResult> {
  const body = await parseJsonBody(res);
  const envelope = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    status: res.status,
    ok: res.ok,
    data: res.ok ? envelope.data : undefined,
    error: res.ok ? undefined : (errorKey(envelope) ?? `status ${res.status}`),
  };
}

/**
 * Pull the BSH `error.key` out of an `{ error: { key } }` body.
 *
 * @param body the parsed response body
 * @returns the error key, or undefined
 */
function errorKey(body: Record<string, unknown>): string | undefined {
  const err = body.error;
  if (err !== null && typeof err === "object") {
    const key = (err as Record<string, unknown>).key;
    if (typeof key === "string") {
      return key;
    }
  }
  return undefined;
}

/**
 * Read a response body as JSON, tolerating an empty or non-JSON body (→ null).
 *
 * @param res the fetch Response to read
 * @returns the parsed JSON, or null if the body is empty or not JSON
 */
async function parseJsonBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
