// Failure-log dedup policy — warn-once-per-category-then-debug, keyed on the
// structured HTTP result (status + BSH error.key), not on error-message string
// matching. homeconnect's HTTP layer already returns typed results, so the
// category comes straight off the status code; a recovery re-arms the warn.
// (Pattern mirrors govee's log-channel-fail, without govee's classifyError
// string-matching, which its https.request boundary needs but this one does not.)

/** Coarse failure class used as the dedup key together with the call source. */
export type FailureCategory = "net" | "auth" | "rate" | "http-4xx" | "http-5xx" | "other";

/**
 * Classify an HTTP outcome into a failure category. Status 0 is a transport
 * error (see http.ts), 401/403 auth, 429 rate-limit, else by status band.
 *
 * @param status the HTTP status (0 on a transport error)
 * @returns the failure category
 */
export function categorize(status: number): FailureCategory {
  if (status === 0) {
    return "net";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 429) {
    return "rate";
  }
  if (status >= 500) {
    return "http-5xx";
  }
  if (status >= 400) {
    return "http-4xx";
  }
  return "other";
}

/**
 * Per-source failure-log deduplicator. The first failure of a category for a
 * given source logs at warn; identical repeats drop to debug; a recovery clears
 * the source so the next failure warns again. Keeps the log honest without
 * spamming when the same failure recurs on every reconnect / re-sync.
 */
export class LogDedup {
  private readonly last = new Map<string, FailureCategory>();

  /**
   * Record a failure and get the level to log it at.
   *
   * @param source a stable per-call-site key (e.g. "GET /status")
   * @param category the failure category ({@link categorize})
   * @returns "warn" for a new category at this source, "debug" for a repeat
   */
  note(source: string, category: FailureCategory): "warn" | "debug" {
    const level = this.last.get(source) === category ? "debug" : "warn";
    this.last.set(source, category);
    return level;
  }

  /**
   * Clear a source after a success. The next failure for it warns again.
   *
   * @param source the source key
   * @returns true if the source had been in a failing state (worth a recovery log)
   */
  recovered(source: string): boolean {
    return this.last.delete(source);
  }
}
