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
  MAX_RESPONSE_BYTES: () => MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS: () => REQUEST_TIMEOUT_MS,
  deleteJson: () => deleteJson,
  getJson: () => getJson,
  postForm: () => postForm,
  putJson: () => putJson,
  readBodyCapped: () => readBodyCapped,
  retryAfterMs: () => retryAfterMs
});
module.exports = __toCommonJS(http_exports);
const REQUEST_TIMEOUT_MS = 2e4;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
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
  const parsed = await parseJsonBody(res);
  if (parsed.tooLarge) {
    return { status: 0, ok: false, body: { error: "response_too_large" } };
  }
  return { status: res.status, ok: res.ok, body: parsed.json };
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
  const parsed = await parseJsonBody(res);
  if (parsed.tooLarge) {
    return { status: res.status, ok: false, data: void 0, error: "response too large" };
  }
  const body = parsed.json;
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
  const text = await readBodyCapped(res, MAX_RESPONSE_BYTES);
  if (text === void 0) {
    return { json: null, tooLarge: true };
  }
  if (text.length === 0) {
    return { json: null, tooLarge: false };
  }
  try {
    return { json: JSON.parse(text), tooLarge: false };
  } catch {
    return { json: null, tooLarge: false };
  }
}
async function readBodyCapped(res, maxBytes) {
  var _a, _b, _c, _d;
  const declared = Number((_c = (_b = (_a = res.headers) == null ? void 0 : _a.get) == null ? void 0 : _b.call(_a, "content-length")) != null ? _c : "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await ((_d = res.body) == null ? void 0 : _d.cancel().catch(() => void 0));
    return void 0;
  }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    return res.text();
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (; ; ) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => void 0);
      return void 0;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  deleteJson,
  getJson,
  postForm,
  putJson,
  readBodyCapped,
  retryAfterMs
});
//# sourceMappingURL=http.js.map
