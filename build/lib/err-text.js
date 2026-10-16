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
var err_text_exports = {};
__export(err_text_exports, {
  errText: () => errText
});
module.exports = __toCommonJS(err_text_exports);
function errText(err) {
  var _a;
  try {
    if (err instanceof Error) {
      const code = "code" in err ? err.code : void 0;
      const message = err.message;
      const name = err.name;
      const text = String(message || (typeof code === "string" ? code : name));
      const cause = err.cause;
      let reason = "";
      if (cause instanceof Error) {
        const causeCode = "code" in cause ? cause.code : void 0;
        const causeMessage = cause.message;
        reason = (typeof causeMessage === "string" ? causeMessage : "") || (typeof causeCode === "string" ? causeCode : "");
      } else if (cause !== void 0 && cause !== null) {
        reason = errText(cause);
      }
      return reason && !text.includes(reason) ? `${text} (${reason})` : text;
    }
    if (typeof err === "string") {
      return err;
    }
    if (typeof err === "function") {
      return Object.prototype.toString.call(err);
    }
    if (err === null || err === void 0 || typeof err !== "object") {
      return String(err);
    }
    return (_a = JSON.stringify(err)) != null ? _a : Object.prototype.toString.call(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  errText
});
//# sourceMappingURL=err-text.js.map
