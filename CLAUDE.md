# CLAUDE.md — ioBroker.homeconnect

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Home Connect** — Bosch, Siemens, NEFF und Gaggenau Hausgeräte über die offizielle [Home Connect](https://www.home-connect.com/) Cloud-API (OAuth 2 Device Flow, REST + Server-Sent-Events).

- **Version + Changelog:** aktuelle Version in `io-package.json`; user-facing Changelog: `README.md` + `io-package.json` news (11 Sprachen, handgeschrieben).
- **GitHub:** https://github.com/krobipd/ioBroker.homeconnect — Default-Branch `main` (direkt auf `main` entwickeln, kein Sonderweg).
- **Herkunft:** Greenfield-TS-Neubau, ersetzt den Alt-Code des Community-Adapters (TA2k + Lucky-ESA, `iobroker-community-adapters/ioBroker.homeconnect`). Community-Historie via `git merge -s ours` erhalten; Copyright volle Kette (Memory `reference_copyright_credits_rewrite`). npm-Name gehört bis zu einer möglichen Übernahme dem Community-Paket → Release als Tag + GitHub, **kein npm**. **Version bleibt < 2.0.0**, solange die Zukunft (Bestand-Übernahme vs. eigenständiger Adapter) offen ist.
- **Runtime-Deps:** nur `@iobroker/adapter-core` — HTTP/OAuth/SSE laufen auf Node-22-`fetch` + `AbortSignal.timeout`, kein axios/eventsource.
- **Test-Setup:** vitest, Tests neben Source unter `src/**/*.test.ts`.

## Architektur

```
src/main.ts                     → Adapter-Lifecycle, OAuth-Verdrahtung, Event-Stream-Verdrahtung, REST-Transport (apiGet/apiWrite: 401→Refresh, Retry-After-Pause, Dedup-Log), Notification, onStateChange→ApplianceSync
src/lib/appliance-sync.ts       → Gerätebaum-Aufbau + Schreibpfad, extrahiert aus main (injizierter AdapterPort → unit-testbar). Priming der Maps aus vorhandenen Objekten (Offline-Write nach Neustart), Prune stale States (nur bei erfolgreichem GET), Slug-Kollisions-Entdopplung, Re-Sync-Serialisierung, top-level try/catch je fire-and-forget-Pfad
src/lib/oauth.ts                → OAuth Device Flow + Token-Refresh (rotierender Refresh-Token, OAuthError.oauthError trennt invalid_grant von transient; extractRefreshToken liest Alt-Klartext UND eigenes Format)
src/lib/http.ts                 → fetch-Transport: postForm (OAuth) + getJson/putJson/deleteJson (Bearer, {data}-Envelope, BSH error.key, Retry-After auf 429)
src/lib/value-transformer.ts    → BSH-Enum → idiomatischer State (boolean/short-enum+states/number+unit); transformOptionDefinition; parseConstraints (eine Boundary-Parse-Stelle)
src/lib/command-dispatch.ts     → reine Abbildung State-Write → PUT/DELETE-Request (settings/commands/programs/options)
src/lib/event-stream.ts         → EINE persistente SSE-Verbindung (fetch-Stream, Keep-Alive-Watchdog, Backoff-Reconnect: Reset erst nach ≥60s stabiler Verbindung)
src/lib/sse-parser.ts           → reiner inkrementeller SSE-Zeilen-Parser
src/lib/log-dedup.ts            → warn-once-per-Kategorie-dann-debug für REST-Fehler (auf status+error.key, kein String-Matching)
src/lib/pure-helpers.ts         → slugify + disambiguateSlug + errMessage + API-Boundary-Guards (isRecord/numberOrUndef/stringArrayOrUndef)
src-admin/                      → React-Anmelde-Panel (Module-Federation, Admin-8-only, guiApi 2). Zeigt Verifizierungs-Link + Status live via Socket. Build → admin/custom (git-getrackt). Vorbild public-holidays. → `.claude/rules/admin-component.md`
```

## Design-Entscheidungen

1. **Node-22-`fetch`** statt axios — keine Extra-Dependency, kein manueller Timeout-Timer (`AbortSignal.timeout`).
2. **Eigener SSE-Parser** statt `eventsource` — der Alt-Adapter hatte dort den Listener-Leak (unpassende Arrow-Refs bei add/remove).
3. **Token VERSCHLÜSSELT** (`adapter.encrypt`/`decrypt` in `auth.session`) — der Alt-Adapter speicherte Klartext (Bug).
4. **Sprechende State-IDs** — `events.programFinished` statt `BSH_Common_Event_ProgramFinished`; Werte als boolean/short-enum/number statt roher BSH-Strings. Das ist der Kern des Rewrites.
5. **Ein `applyBshItem`-Pfad** für REST-Sync UND Stream — Programm-States (Root.ActiveProgram/SelectedProgram) laufen als synthetische Items durch denselben Pfad → REST + Live-Updates konvergieren, statt doppelte Objekte anzulegen.
6. **Objekt nur einmal anlegen** (`knownStates`-Map) — Events setzen danach nur noch den Wert (`setStateChanged`), nie das Objekt neu → vermeidet die Objektbaum-Flut des Alt-Adapters (#387).
7. **Optionen nur an `selected/options`** — Schreiben aufs aktive Programm ist geräte-zustandsabhängig (409 in den meisten Zuständen); ein Ziel ist vorhersagbar. Definition (Typ/Constraints) aus `programs/available/{program}`.
8. **Schreib-Bestätigung** — erfolgreicher non-button-Write wird mit `ack:true` bestätigt (selected/options sendet evtl. kein NOTIFY); momentane Buttons setzen sich nach dem Druck auf `false` zurück.

## Wertekonvertierung (value-transformer)

- **Event** (`.Event.`, EventPresentState) → boolean (`Present` → `true`).
- **Enum** (`.EnumType.`/`.Program.`) → short-Wert (`…OperationState.Run` → `"run"`) + `common.states`.
- **Zahl** → number + `unit` + `min`/`max` aus Constraints.
- **Schreibbare Enums** (settings, selectedProgram, Optionen) tragen die vollen BSH-Werte in `native.bshValues` — `shortEnum` ist verlustbehaftet, der Schreibpfad löst den short-Wert darüber zurück auf.

## Quirks / Always-Rules

- **`onUnload` synchron** — Timer clearen, `void setState`, `callback()` sofort.
- **Async-Handler** `.bind(this)` + top-level `try/catch` im Body.
- **Rate-Limit** 1000 Requests/Tag + 50/Minute — kein Polling-Sturm; der Event-Stream ist der Update-Pfad, ein `CONNECTED`/`PAIRED`-Event triggert den Re-Sync eines Geräts (kein Poll-Intervall).
- **API-Boundary-Type-Guards** — `isRecord`/`numberOrUndef`/`stringArrayOrUndef` vor Zugriff auf externe Daten.

## Tests

vitest, Tests neben Source unter `src/**/*.test.ts` — die reinen Bausteine (oauth, http, value-transformer, command-dispatch, sse-parser) sind vollständig unit-getestet; `main.ts` deckt der Boot-Test ab. Externe API-Werte werden an der Grenze type-guarded.

## Versionshistorie

Aktuelle Version: `io-package.json`. User-facing Changelog: `README.md` + `io-package.json:common.news` (11 Sprachen, handgeschrieben). Interne Entwicklungs-Historie: `.claude/dev-history.md` (lokal, nicht git-getrackt).

## Befehle

```bash
npm run build            # Production-Build (esbuild via build-adapter)
npm run check            # tsc --noEmit (Type-Check ohne Build)
npm run test:ts          # Unit-Tests via vitest
npm test                 # test:ts + test:package (lokal)
npm run test:integration # Boot-Test (Adapter startet real)
npm run lint             # ESLint
```
