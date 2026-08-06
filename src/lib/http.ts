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
