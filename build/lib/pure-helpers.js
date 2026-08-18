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
var pure_helpers_exports = {};
__export(pure_helpers_exports, {
  disambiguateSlug: () => disambiguateSlug,
  errMessage: () => errMessage,
  isRecord: () => isRecord,
  numberOrUndef: () => numberOrUndef,
  slugify: () => slugify,
  stringArrayOrUndef: () => stringArrayOrUndef
});
module.exports = __toCommonJS(pure_helpers_exports);
function slugify(name) {
  const slug = name.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "device";
}
function disambiguateSlug(baseSlug, haId, taken) {
  if (!taken.has(baseSlug)) {
    return baseSlug;
  }
  const suffix = haId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toLowerCase() || "2";
  let candidate = `${baseSlug}-${suffix}`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${baseSlug}-${suffix}-${n++}`;
  }
  return candidate;
}
function errMessage(e) {
  return e instanceof Error ? e.message : String(e);
}
function isRecord(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function numberOrUndef(v) {
  return typeof v === "number" ? v : void 0;
}
function stringArrayOrUndef(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  disambiguateSlug,
  errMessage,
  isRecord,
  numberOrUndef,
  slugify,
  stringArrayOrUndef
});
//# sourceMappingURL=pure-helpers.js.map
