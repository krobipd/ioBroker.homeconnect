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
var placeholders_exports = {};
__export(placeholders_exports, {
  Placeholders: () => Placeholders,
  leaked: () => leaked,
  valuePattern: () => valuePattern
});
module.exports = __toCommonJS(placeholders_exports);
var import_node_net = require("node:net");
const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<!\\d|\\d\\.)${OCTET}(?:\\.${OCTET}){3}(?!\\d|\\.\\d)`, "g");
const IPV6_CANDIDATE = /(?<![\w.])[0-9A-Fa-f:.]{2,45}(?![\w:])/g;
const HARDWARE = /(?<![0-9A-Fa-f:-])[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}(?:(?:[:-][0-9A-Fa-f]{2}){2})?(?![0-9A-Fa-f:-])/g;
const BARE_MAC = /(?<![0-9A-Za-z])(?=[0-9A-Fa-f]*[A-Fa-f])(?=[0-9A-Fa-f]*\d)[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GAP = "(?:%[0-9A-Fa-f]{2}|[^\\p{L}\\p{N}\"'`{}\\[\\]<>\\\\])";
function loose(value) {
  const words = value.split(/[^\p{L}\p{N}"'`{}[\]<>\\]+/u).filter((word) => word.length > 0);
  if (words.length === 0) {
    return escape(value);
  }
  return words.map(
    (word, i) => i === 0 ? escape(word) : `${GAP}{${/\d$/.test(words[i - 1]) && /^\d/.test(word) ? 1 : 0},6}${escape(word)}`
  ).join("");
}
function valuePattern(value, kind = "name") {
  value = value.normalize("NFC");
  if (kind !== "name") {
    return new RegExp(loose(value.trim()), "giu");
  }
  const words = value.toLowerCase().split(/[\s_-]+/).map(escape);
  const forms = `(?:${escape(value)}|${words.join("[ _-]")})`;
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${forms}(?![\\p{L}\\p{N}_-])`, "gu");
}
const MAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
class Placeholders {
  known = /* @__PURE__ */ new Map();
  counts = /* @__PURE__ */ new Map();
  names = /* @__PURE__ */ new Map();
  /**
   * The placeholder for one value.
   *
   * @param kind what it is, the placeholder's word (`address`, `mac`, `name`, `serial` …)
   * @param value the real value
   * @returns the placeholder
   */
  mark(kind, value) {
    var _a;
    const key = `${kind}\0${value.toLowerCase()}`;
    const known = this.known.get(key);
    if (known) {
      return known;
    }
    const n = ((_a = this.counts.get(kind)) != null ? _a : 0) + 1;
    this.counts.set(kind, n);
    const placeholder = `${kind}-${n}`;
    this.known.set(key, placeholder);
    return placeholder;
  }
  /**
   * Register a name the user gave (a device, room or network name) or any other personal value: from now on it is
   * replaced wherever it stands as a whole word, as written or in the lower-case id form (`valuePattern`). Registered
   * again, a value keeps its first placeholder, and any other kind replaces the narrower `name`, never the reverse.
   *
   * @param value the real value (blank ones are ignored)
   * @param kind the placeholder's word, `name` when not given
   * @returns the placeholder, or the value itself when it is blank
   */
  name(value, kind = "name") {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }
    const known = this.names.get(trimmed);
    if (known) {
      if (kind !== "name") {
        known.kind = kind;
      }
      return known.placeholder;
    }
    const placeholder = this.mark(kind, trimmed);
    this.names.set(trimmed, { placeholder, kind });
    return placeholder;
  }
  /**
   * Replace everything personal in a text: the registered names (longest first, as whole words), then mail, hardware
   * ids and IP addresses by their form.
   *
   * @param text the text
   * @returns the text with placeholders
   */
  text(text) {
    let out = text.normalize("NFC");
    const names = [...this.names.entries()].sort(
      ([a, x], [b, y]) => b.length - a.length || Number(x.kind === "name") - Number(y.kind === "name")
    );
    for (const [name, { placeholder, kind }] of names) {
      out = out.replace(valuePattern(name, kind), placeholder);
    }
    out = out.replace(MAIL, (match) => this.mark("mail", match));
    out = out.replace(HARDWARE, (match) => this.mark("mac", match.replace(/-/g, ":")));
    out = out.replace(BARE_MAC, (match) => this.mark("mac", match.replace(/(..)(?!$)/g, "$1:")));
    out = out.replace(IPV6_CANDIDATE, (match) => {
      const address = match.replace(/\.+$/, "");
      return (0, import_node_net.isIPv6)(address) && /[0-9A-Fa-f]/.test(address) ? this.mark("address", address) + match.slice(address.length) : match;
    });
    return out.replace(IPV4, (match) => this.mark("address", match));
  }
  /**
   * Replace in every string of a value and in every object key — a device keyed by its address or name is as
   * personal as the value.
   *
   * @param value any JSON-like value
   * @returns a copy with placeholders
   */
  deep(value) {
    var _a;
    if (typeof value === "string") {
      return this.text(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.deep(item));
    }
    if (value !== null && typeof value === "object") {
      const out = {};
      const counts = /* @__PURE__ */ new Map();
      for (const [key, item] of Object.entries(value)) {
        const base = this.text(key);
        let name = base;
        let n = (_a = counts.get(base)) != null ? _a : 1;
        while (Object.hasOwn(out, name)) {
          n++;
          name = `${base}#${n}`;
        }
        counts.set(base, n);
        out[name] = this.deep(item);
      }
      return out;
    }
    return value;
  }
}
const plain = (text) => text.normalize("NFKC").replace(/%[0-9A-Fa-f]{2}/g, " ").replace(/[ßẞ]/g, "ss");
function leaked(report, secrets) {
  const text = plain(report);
  return secrets.filter((secret) => {
    const value = plain(secret).trim();
    if (!value) {
      return false;
    }
    const words = value.split(/[^\p{L}\p{N}"'`{}[\]<>\\]+/u).filter((word) => word.length > 0);
    const gap = "[^\\p{L}\\p{N}\"'`{}\\[\\]<>\\\\]";
    const body = words.length === 0 ? escape(value) : words.map(
      (word, i) => i === 0 ? escape(word) : `${gap}${/\d$/.test(words[i - 1]) && /^\d/.test(word) ? "+" : "*"}${escape(word)}`
    ).join("");
    const before = /^\d/.test(value) ? "(?<!\\d)" : "";
    const after = /\d$/.test(value) ? "(?!\\d)" : "";
    return new RegExp(`${before}${body}${after}`, "iu").test(text);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Placeholders,
  leaked,
  valuePattern
});
//# sourceMappingURL=placeholders.js.map
