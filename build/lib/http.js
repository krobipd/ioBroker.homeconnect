"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var http_exports = {};
__export(http_exports, {
  REQUEST_TIMEOUT_MS: () => REQUEST_TIMEOUT_MS,
  deleteJson: () => deleteJson,
  getJson: () => getJson,
  postForm: () => postForm,
  putJson: () => putJson,
  retryAfterMs: () => retryAfterMs
});
module.exports = __toCommonJS(http_exports);
const REQUEST_TIMEOUT_MS = 2e4;
async function postForm(baseUrl, path, form, timeoutMs = REQUEST_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json"
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    return { status: 0, ok: false, body: { error: "network_error", error_description: String(e) } };
  }
  return { status: res.status, ok: res.ok, body: await parseJsonBody(res) };
}
function getJson(baseUrl, path, accessToken, acceptLanguage, timeoutMs = REQUEST_TIMEOUT_MS) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.bsh.sdk.v1+json"
  };
  if (acceptLanguage) {
    headers["accept-language"] = acceptLanguage;
  }
  return requestJson(baseUrl, path, { method: "GET", headers }, timeoutMs);
}
function putJson(baseUrl, path, accessToken, data, timeoutMs = REQUEST_TIMEOUT_MS) {
  return requestJson(
    baseUrl,
    path,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/vnd.bsh.sdk.v1+json"
      },
      body: JSON.stringify({ data })
    },
    timeoutMs
  );
}
function deleteJson(baseUrl, path, accessToken, timeoutMs = REQUEST_TIMEOUT_MS) {
  return requestJson(
    baseUrl,
    path,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.bsh.sdk.v1+json" }
    },
    timeoutMs
  );
}
async function requestJson(baseUrl, path, init, timeoutMs) {
  let res;
  try {
    res = await fetch(new URL(path, baseUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { status: 0, ok: false, data: void 0, error: `network_error: ${String(e)}` };
  }
  return toJsonResult(res);
}
async function toJsonResult(res) {
  var _a;
  const body = await parseJsonBody(res);
  const envelope = body !== null && typeof body === "object" ? body : {};
  return {
    status: res.status,
    ok: res.ok,
    data: res.ok ? envelope.data : void 0,
    error: res.ok ? void 0 : (_a = errorKey(envelope)) != null ? _a : `status ${res.status}`,
    retryAfterMs: res.status === 429 ? retryAfterMs(res.headers.get("retry-after")) : void 0
  };
}
function retryAfterMs(header) {
  if (header === null || !/^\d+$/.test(header.trim())) {
    return void 0;
  }
  return parseInt(header.trim(), 10) * 1e3;
}
function errorKey(body) {
  const err = body.error;
  if (err !== null && typeof err === "object") {
    const key = err.key;
    if (typeof key === "string") {
      return key;
    }
  }
  return void 0;
}
async function parseJsonBody(res) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  REQUEST_TIMEOUT_MS,
  deleteJson,
  getJson,
  postForm,
  putJson,
  retryAfterMs
});
//# sourceMappingURL=http.js.map
