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
var known_objects_exports = {};
__export(known_objects_exports, {
  KnownObjects: () => KnownObjects,
  coveredBy: () => coveredBy,
  mergedWith: () => mergedWith,
  sameStructure: () => sameStructure,
  storedAfterSet: () => storedAfterSet
});
module.exports = __toCommonJS(known_objects_exports);
function isPlain(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function mergedWith(stored, patch) {
  if (Array.isArray(patch)) {
    const base2 = Array.isArray(stored) ? [...stored] : [];
    patch.forEach((value, i) => {
      if (value !== void 0) {
        base2[i] = mergedWith(base2[i], value);
      }
    });
    return base2;
  }
  if (!isPlain(patch)) {
    return patch;
  }
  const base = isPlain(stored) ? { ...stored } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== void 0) {
      base[key] = mergedWith(base[key], value);
    }
  }
  return base;
}
function sameStructure(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameStructure(value, b[i]));
  }
  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameStructure(a[key], b[key]));
  }
  return false;
}
function coveredBy(patch, stored) {
  return sameStructure(mergedWith(stored, patch), stored);
}
const STAMPED = ["from", "user", "ts"];
const PRESERVED_COMMON = ["custom", "smartName", "material", "habpanel", "mobile"];
function storedAfterSet(id, stored, obj) {
  if (!isPlain(obj)) {
    return obj;
  }
  const result = structuredClone(obj);
  const old = isPlain(stored) ? stored : void 0;
  for (const key of STAMPED) {
    if (old && key in old) {
      result[key] = old[key];
    } else {
      delete result[key];
    }
  }
  result._id = id;
  if (old && old.acl !== void 0 && result.acl === void 0) {
    result.acl = structuredClone(old.acl);
  }
  const oldCommon = old && isPlain(old.common) ? old.common : void 0;
  if (oldCommon) {
    const common = isPlain(result.common) ? result.common : {};
    let touched = isPlain(result.common);
    for (const key of PRESERVED_COMMON) {
      const before = oldCommon[key];
      if (key === "custom") {
        const custom = isPlain(common.custom) ? common.custom : void 0;
        if (!custom && isPlain(before) && result.type === "state") {
          common.custom = structuredClone(before);
          touched = true;
        } else if (custom && isPlain(before)) {
          for (const attr of Object.keys(before)) {
            if (custom[attr] === void 0) {
              custom[attr] = structuredClone(before[attr]);
            }
          }
        }
        if (isPlain(common.custom)) {
          for (const attr of Object.keys(common.custom)) {
            if (common.custom[attr] === null) {
              delete common.custom[attr];
            }
          }
          if (Object.keys(common.custom).length === 0) {
            delete common.custom;
          }
        }
      } else if (common[key] === null) {
        delete common[key];
      } else if (before !== void 0 && common[key] === void 0) {
        common[key] = structuredClone(before);
      }
    }
    if (touched) {
      result.common = common;
    }
  }
  return result;
}
class KnownObjects {
  adapter;
  objects = /* @__PURE__ */ new Map();
  /** The last running operation per id — a later one on the same id starts after it. */
  running = /* @__PURE__ */ new Map();
  /** The running operations that cover a whole subtree (a recursive remove, the load of the own tree). */
  subtrees = /* @__PURE__ */ new Map();
  /** @param adapter the adapter */
  constructor(adapter) {
    this.adapter = adapter;
  }
  /**
   * The full id of an own object.
   *
   * @param id relative or full id
   * @returns the id with the namespace in front
   */
  full(id) {
    const ns = `${this.adapter.namespace}.`;
    return id.startsWith(ns) ? id : `${ns}${id}`;
  }
  /**
   * Runs one operation after every running one it overlaps: the same id, an id below a running subtree operation, or —
   * for a subtree operation — any running id below it. Each compares against and merges onto what the one before it
   * left; two that overlapped both read the object as it stood before them, and the later one wrote its picture over
   * the earlier patch in the store, so a write back to the old value was judged "already there" and left out. A failed
   * operation does not block the ones after it.
   *
   * @param key the full id
   * @param subtree whether the operation covers everything below the id
   * @param operation the read-compare-write
   * @returns what the operation returns
   */
  serialized(key, subtree, operation) {
    const below = `${key}.`;
    const before = [];
    const same = this.running.get(key);
    if (same) {
      before.push(same);
    }
    if (subtree) {
      for (const [other, done2] of this.running) {
        if (other.startsWith(below)) {
          before.push(done2);
        }
      }
    }
    for (const [root, done2] of this.subtrees) {
      if (key.startsWith(`${root}.`)) {
        before.push(done2);
      }
    }
    const result = Promise.all(before).then(operation);
    const done = result.then(
      () => void 0,
      () => void 0
    );
    this.running.set(key, done);
    if (subtree) {
      this.subtrees.set(key, done);
    }
    void done.then(() => {
      if (this.running.get(key) === done) {
        this.running.delete(key);
      }
      if (this.subtrees.get(key) === done) {
        this.subtrees.delete(key);
      }
    });
    return result;
  }
  /** Reads the whole own tree with one call. Before it, only what this instance wrote itself is known. */
  async load() {
    const ns = `${this.adapter.namespace}.`;
    return await this.serialized(this.adapter.namespace, true, async () => {
      const list = await this.adapter.getObjectListAsync({ startkey: ns, endkey: `${ns}\u9999` });
      this.objects.clear();
      for (const row of list.rows) {
        if (row.value) {
          this.objects.set(row.id, row.value);
        }
      }
    });
  }
  /**
   * The object as last read or written.
   *
   * @param id relative or full id
   * @returns the object, undefined when unknown
   */
  get(id) {
    return this.objects.get(this.full(id));
  }
  /**
   * `extendObject`, left out when the stored object already carries the patch.
   *
   * @param id relative or full id
   * @param patch the fields to merge
   * @returns whether the database was written
   */
  async extend(id, patch) {
    const key = this.full(id);
    return await this.serialized(key, false, async () => {
      const stored = this.objects.get(key);
      if (coveredBy(patch, stored)) {
        return false;
      }
      await this.adapter.extendObject(id, patch);
      this.objects.set(key, mergedWith(stored, patch));
      return true;
    });
  }
  /**
   * `setForeignObject` of a whole object, left out when the database would hold the same afterwards.
   *
   * @param id full id
   * @param obj the whole object
   * @returns whether the database was written
   */
  async replace(id, obj) {
    return await this.serialized(this.full(id), false, async () => {
      const stored = this.objects.get(id);
      const after = storedAfterSet(id, stored, obj);
      if (sameStructure(after, stored)) {
        return false;
      }
      await this.adapter.setForeignObject(id, obj);
      this.objects.set(id, after);
      return true;
    });
  }
  /**
   * `delObject` — the object (with `recursive` its children too) is forgotten, so an id used again is written anew.
   *
   * @param id relative or full id
   * @param options delete the children too
   * @param options.recursive whether the children go as well
   */
  async remove(id, options = { recursive: false }) {
    const key = this.full(id);
    await this.serialized(key, options.recursive, async () => {
      await this.adapter.delObjectAsync(id, options);
      for (const known of [...this.objects.keys()]) {
        if (known === key || options.recursive && known.startsWith(`${key}.`)) {
          this.objects.delete(known);
        }
      }
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KnownObjects,
  coveredBy,
  mergedWith,
  sameStructure,
  storedAfterSet
});
//# sourceMappingURL=known-objects.js.map
