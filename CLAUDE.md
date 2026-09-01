# CLAUDE.md — ioBroker.homeconnect

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Home Connect** — Bosch, Siemens, NEFF und Gaggenau Hausgeräte über die offizielle [Home Connect](https://www.home-connect.com/) Cloud-API (OAuth 2 Device Flow, REST + Server-Sent-Events).

- **Version + Changelog:** aktuelle Version in `io-package.json`; user-facing Changelog: `README.md` + `io-package.json` news (11 Sprachen, handgeschrieben).
- **GitHub:** https://github.com/krobipd/ioBroker.homeconnect — Default-Branch `main` (direkt auf `main` entwickeln, kein Sonderweg). Der `developing`-Zweig im Repo ist ein UNGENUTZTES Überbleibsel (steht 19 Commits zurück) — die CI deckt ihn seit 2026-08-23 trotzdem mit ab, damit ein Push dorthin nicht ungeprüft bliebe.
- **Herkunft:** Greenfield-TS-Neubau, ersetzt den Alt-Code des Community-Adapters (TA2k + Lucky-ESA, `iobroker-community-adapters/ioBroker.homeconnect`). Community-Historie via `git merge -s ours` erhalten; Copyright volle Kette (Memory `reference_copyright_credits_rewrite`). npm-Name gehört bis zu einer möglichen Übernahme dem Community-Paket → Release als Tag + GitHub, **kein npm**. **Version bleibt < 2.0.0**, solange die Zukunft (Bestand-Übernahme vs. eigenständiger Adapter) offen ist.
- **Runtime-Deps:** nur `@iobroker/adapter-core` — HTTP/OAuth/SSE laufen auf Node-22-`fetch` + `AbortSignal.timeout`, kein axios/eventsource.
- **Test-Setup:** vitest, Tests neben Source unter `src/**/*.test.ts`.

## Architektur

```
src/main.ts                     → Adapter-Lifecycle, Port-Verdrahtung (AuthController + ApplianceSync + EventStream), REST-Transport (apiGet/apiWrite: 401→Refresh, Retry-After-Pause MIT 60s-Fallback ohne Header, Dedup-Log + Recovery-Info, Write-Drop bei Rate-Pause sichtbar; ERWARTETE BSH-Antworten NoProgramActive/NoProgramSelected/WrongOperationState = debug, kein warn/Recovery), `terminating`-Wächter (onUnload setzt ihn; apiGet/apiWrite/startEventStream steigen aus — sonst synct die fire-and-forget-Startkette am Teardown vorbei und eröffnet den Stream neu → „setTimeout called, but adapter is shutting down"), Notification, onStateChange→ApplianceSync
src/lib/auth-controller.ts      → Anmelde-Lebenszyklus, extrahiert aus main (injizierter AuthPort → unit-testbar): Device Flow inkl. Poll (slow_down verlängert Intervall), Refresh-Timer, invalid_grant beim START UND zur LAUFZEIT → frischer Device-Flow (Link/Notification), abgelaufener/abgelehnter Anmelde-Link erneuert sich selbst, transienter Refresh-Fehler = Retry mit behaltenem Login (warn-once, Backoff 30 s verdoppelnd bis 30 min — Token-Endpunkt-Kontingent 100/Tag)
src/lib/appliance-sync.ts       → Gerätebaum-Aufbau + Schreibpfad, extrahiert aus main (injizierter AdapterPort → unit-testbar). Geräte-Ordner-ID = E-NUMMER vom Typenschild (applianceIdSource: enumber→vib→haId; einmal vergeben, dann via DB gepinnt — App-Umbenennung ändert nur den Anzeigenamen), migrateDeviceIds VOR allem (zieht Alt-Bäume namensbasierter IDs komplett um: Device/Channels/States/Werte/custom, statusStates-Link umgeschrieben; besetzte Ziel-IDs → Serien-Suffix, ohne Typenschild-native wartet der Baum einen Start), Priming der Maps aus vorhandenen Objekten (Offline-Write nach Neustart), Migration umbenannter Datenpunkte VOR dem Priming (misc-Reparatur, Tür-Booleans, programs-Kanal programloser Typen; 1:1 nimmt custom/Name mit), signaturbasierter Metadaten-Refresh beim REST-Sync (metaSignature; Replace via delObject→setObjectNotExists, Name/custom/Wert bleiben), KEIN Prune (Datenpunkte verschwinden nie — Löschen nur bei Konto-Entfernung), Katalog-Events vorab je Gerätetyp, Definitions-Cache je Programm (einmalig laden, persistiert in device native.programOptions), Options-Objekte = Vereinigung aller Programme, per-Gerät info.reachable (CONNECTED/DISCONNECTED/DEPAIRED, Übergänge als DEBUG-Log mit Label `Name (id)`; EINE „Setting up N appliance(s)"-Info-Zeile VOR der Geräte-Schleife, „New appliance"-Info nur bei Erstvergabe), Slug-Kollisions-Entdopplung, Re-Sync-Serialisierung, Options-Schreibgate (nur Optionen des GEWÄHLTEN Programms), top-level try/catch je fire-and-forget-Pfad
src/lib/device-catalog.ts       → Gerätetyp-Katalog (rein): Events je Typ (17 Typen, 49 Schlüssel — Quelle Ressourcen/homeconnect/device-type-catalog-2026-09-01.md), verriegelbare Türen, programlose Typen
src/lib/oauth.ts                → OAuth Device Flow + Token-Refresh (rotierender Refresh-Token, OAuthError.oauthError trennt invalid_grant von transient; pollForToken liefert token/"pending"/"slow_down"; extractRefreshToken liest Alt-Klartext UND eigenes Format)
src/lib/http.ts                 → fetch-Transport: postForm (OAuth) + getJson/putJson/deleteJson über EINEN requestJson-Kern (Bearer, {data}-Envelope, BSH error.key, Retry-After auf 429)
src/lib/value-transformer.ts    → BSH-Enum → idiomatischer State (boolean/short-enum+states/number+unit+step); Kind-Segment wird IRGENDWO im Schlüssel gefunden, Rest camelCase-verbunden (kein misc mehr); expandBshItem: DoorState→doorOpen(+doorLocked bei verriegelbaren Typen), Status.Door.*→door<Fach>Open, OperationState→zusätzlich programRunning; constraints.access="read" ⇒ write:false; transformOptionDefinition; parseConstraints (eine Boundary-Parse-Stelle)
src/lib/command-dispatch.ts     → reine Abbildung State-Write → PUT/DELETE-Request (settings/commands/programs/options)
src/lib/event-stream.ts         → EINE persistente SSE-Verbindung (fetch-Stream, Keep-Alive-Watchdog, Backoff-Reconnect: Reset erst nach ≥60s stabiler Verbindung)
src/lib/sse-parser.ts           → reiner inkrementeller SSE-Zeilen-Parser; Puffer-Deckel 1 MB (endloser Datenstrom ohne Zeilenumbruch/Leerzeile wird verworfen statt Speicher zu fressen)
src/lib/log-dedup.ts            → warn-once-per-Kategorie-dann-debug für REST-Fehler (auf status+error.key, kein String-Matching)
src/lib/legacy-cleanup.ts       → reine Plan-Funktion (fakeroku-Muster): erkennt Alt-Generation-Bäume (haId-Wurzel mit Großbuchstaben ODER Unterstrich-BSH-Blätter) → main löscht sie rekursiv beim Start, VOR dem Priming; auth/info + eigene device-Bäume (native.haId) sind tabu
src/lib/pure-helpers.ts         → slugify (Umlaut-Transliteration + Unicode-Akzent-Strip) + disambiguateSlug + errMessage + API-Boundary-Guards (isRecord/numberOrUndef/stringArrayOrUndef)
src-admin/                      → React-Anmelde-Panel (Module-Federation, Admin-8-only, guiApi 2). Zeigt Verifizierungs-Link + Status live via Socket. Build → admin/custom (git-getrackt). Vorbild public-holidays. → `.claude/rules/admin-component.md`
```

## Design-Entscheidungen

1. **Node-22-`fetch`** statt axios — keine Extra-Dependency, kein manueller Timeout-Timer (`AbortSignal.timeout`).
2. **Eigener SSE-Parser** statt `eventsource` — der Alt-Adapter hatte dort den Listener-Leak (unpassende Arrow-Refs bei add/remove).
3. **Token VERSCHLÜSSELT** (`adapter.encrypt`/`decrypt` in `auth.session`) — der Alt-Adapter speicherte Klartext (Bug).
4. **Sprechende State-IDs** — `events.programFinished` statt `BSH_Common_Event_ProgramFinished`; Werte als boolean/short-enum/number statt roher BSH-Strings. Das ist der Kern des Rewrites. **Geräte-Ordner-ID = E-Nummer vom Typenschild** (krobi 2026-09-01, z. B. `sx87tx02ce-60`; Fallback vib→haId): unveränderlich und modell-identifizierend — der App-Name ist änderbar und kollidiert bei Standardnamen („Geschirrspüler"), er bleibt als `common.name` sichtbar und folgt der App live. Baugleiche Geräte → Serien-Suffix aus der haId (von Anfang an eingebaut). Alt-Bäume zieht `migrateDeviceIds` beim Update automatisch um. Das Kind-Segment (Status/Setting/Event/Option/Command/Root) wird IRGENDWO im Schlüssel gesucht, der Rest camelCase-verbunden (`…Status.Door.Freezer` → `status.doorFreezer`-Basis, `…Setting.Light.Internal.Brightness` → `settings.lightInternalBrightness`) — die alte Vorletztes-Segment-Regel schob verschachtelte Schlüssel in einen falschen `misc`-Kanal UND machte Settings dort fälschlich schreibgeschützt (v1.12.0-Migration räumt das um). **Türen sind Booleans** (`doorOpen` + `doorLocked` bei Oven/Microwave/Washer/Dryer/WasherDryer, `door<Fach>Open` je Kühlgerätefach), **`programRunning`** ist der abgeleitete Läuft-gerade-Schalter neben `operationState`.
5. **Ein `applyBshItem`-Pfad** für REST-Sync UND Stream — Programm-States (Root.ActiveProgram/SelectedProgram) laufen als synthetische Items durch denselben Pfad → REST + Live-Updates konvergieren, statt doppelte Objekte anzulegen.
6. **Stream setzt nur Werte, REST besitzt die Metadaten** (`knownStates` + `metaSignature`) — Stream-Events legen ein Objekt höchstens neu an, nie um (→ keine Objektbaum-Flut des Alt-Adapters, #387). Ein REST-Sync frischt Objekt-Metadaten auf, wenn sich die Signatur ändert (neue allowedvalues, geänderte Grenzen, verbesserter Transformer): Full-Replace via `delObject`→`setObjectNotExists` (extendObject kann Keys nicht löschen; `setObject` = repochecker-S5054-verboten), Nutzer-Umbenennung/`custom`/State-Wert bleiben erhalten. Options-WERTE eines Programms zählen als Stream (die Objekt-Form gehört der Options-DEFINITION).
   **Datenpunkte verschwinden NIE** (krobi 2026-09-01): die Cloud liefert je Betriebszustand eine TEILMENGE (Standby-Waschtrockner meldet nur `powerState`) — „fehlt in der Antwort" heißt nie „Gerät kann es nicht". Es gibt keinen Prune-Schritt; gelöscht wird ausschließlich ein vom Konto entferntes Gerät (Entscheidung Nr. 9) und die Alt-Generation (Nr. 10). ⚠️ v1.7.0–v1.11.0 hatten einen Ausputz-Schritt — das war der childLock-weg-beim-Ausschalten-Fehler.
7. **Optionen nur an `selected/options`** — Schreiben aufs aktive Programm ist geräte-zustandsabhängig (409 in den meisten Zuständen); ein Ziel ist vorhersagbar. **Alle Datenpunkte sofort:** beim Sync werden die Definitionen ALLER verfügbaren Programme geladen (je Programm EINMAL, dann Cache in `device native.programOptions` — überlebt Neustarts, Programmwechsel/Reconnect kosten 0 Abrufe, und der „wrong operation state"-Verweigerer während des Laufs trifft uns nicht mehr); die Options-Objekte tragen die VEREINIGUNG (Werte-Union, Grenzen geweitet) und werden beim Programmwechsel nicht umgeschrieben. Schreibbar Richtung Cloud sind nur Optionen des GEWÄHLTEN Programms (`optionKeys`-Gate aus dem Cache) — alles andere wird gar nicht erst gesendet. Fehlt die Programmliste (läuft gerade), springt der Cache ein (Flacker-Schutz für `selectedProgram`).
   **Gerätetyp-Katalog** (`device-catalog.ts`, Quelle `Ressourcen/homeconnect/device-type-catalog-2026-09-01.md`): Events sind über REST nicht aufzählbar → sie werden je Typ VORAB angelegt (17 Typen, 49 Schlüssel, alle Typen gleichrangig — der Adapter wird für die ganze Community gebaut). Ebenfalls typgesteuert: verriegelbare Türen (doorLocked) und programlose Typen (kein `programs`-Kanal).
8. **Schreib-Bestätigung** — erfolgreicher non-button-Write wird mit `ack:true` bestätigt (selected/options sendet evtl. kein NOTIFY); momentane Buttons setzen sich nach dem Druck auf `false` zurück.
9. **`info.reachable` pro Gerät** — gespeist aus dem `connected`-Flag der Geräteliste + den CONNECTED/DISCONNECTED-Stream-Events. **`statusStates.onlineId` am Geräte-Objekt** (voller Pfad!) macht daraus das grün/graue Symbol im Objektbaum — der Wert allein erzeugt keins (seit v1.11.0; vorher fehlte die Verknüpfung).
   **Die Marker-Kette:** Start-Stempel VOR dem ersten Cloud-Abruf (die Geräteliste kann ausbleiben — abgelaufenes Ticket, kein Netz —, dann korrigiert sonst NIEMAND den alten Wert), WS-Ereignisse im Betrieb, und beim Beenden alle auf unerreichbar mit Rückruf danach. Übergänge loggen auf DEBUG mit Label `Name (id)` (Flotten-Standard, krobi 2026-09-01 — v1.12.0 hatte sie kurz auf info, was jeden Start/Stopp in Einzelzeilen ertränkte; user-sichtbar bleibt die eine „Setting up N appliance(s)"-Zeile plus Baum-Symbol und `info.devices*`). Der Host hilft dabei nicht: sein eigener `info.connection`-Reset schreibt an die falsche Kennung (js-controller#3472), der Adapter ist der einzige Schreiber. Mechanik: Memory `reference_stopinstance_verhindert_onunload`.
   ⚠️ **KORRIGIERT v1.11.0 — vorher stand hier „bei DEPAIRED bleibt der Baum stehen".** Das war MEINE Umsetzung aus dem Neubau, die ich mir selbst als Entscheidung notiert hatte; krobi hat sie nie getroffen und am 2026-08-27 umgekehrt: *„was nicht am server da ist ist auch nicht mehr da"* — ein aus dem Konto entferntes Gerät ist über die Cloud nicht mehr adressierbar, sein Baum wäre toter Ballast. **Zwei Wege müssen zum Löschen führen:** das `DEPAIRED`-Ereignis UND das Fehlen in der Geräteliste (entfernt, während der Adapter aus war). Letzteres NUR nach erfolgreichem Abruf — der `isRecord`-Wächter oben verhindert, dass ein Netzfehler den ganzen Baum leert. **`DISCONNECTED` (nur ausgeschaltet) behält den Baum** — sonst verschwänden die Datenpunkte eines Geschirrspülers jeden Abend.
10. **Der Adapter räumt beim Update selbst auf** (krobi 2026-08-18: „der Adapter muss das aufräumen, nicht der User"): die Alt-Generation-Bäume (rohe haId-Wurzeln) werden beim Start automatisch entfernt (`legacy-cleanup`), der Login wird übernommen. Einzige Nutzer-Handlung beim Umstieg: Client-Secret einmalig nachtragen (die Alt-Generation kannte keins).
11. **Summen-Datenpunkte** (seit v1.11.0) — `info.devicesTotal`/`devicesOnline`/`devicesAllOnline`, abgeleitet in `setReachable()`, der EINEN Stelle, durch die jeder Marker-Schreibvorgang läuft; eine zweite Rechenstelle würde driften. `devicesTotal` überlebt das Beenden, `devicesAllOnline` braucht `total > 0`. ⚠️ Bei Hausgeräten ist „alle verbunden" NICHT der Normalzustand (ein Geschirrspüler ist meistens aus) — der Wert taugt als Anzeige „läuft gerade alles", nicht als Alarmquelle. Flotten-Form: Memory `reference_summen_datenpunkte_flotte`.

## Wertekonvertierung (value-transformer)

- **Event** (`.Event.`, EventPresentState) → boolean (`Present` → `true`).
- **Enum** (`.EnumType.`/`.Program.`) → short-Wert (`…OperationState.Run` → `"run"`) + `common.states`.
- **Zahl** → number + `unit` + `min`/`max`/`step` aus Constraints.
- **`constraints.access === "read"`** ⇒ `write:false`, auch im settings-Kanal (die API kennt Nur-Lese-Settings).
- **Schreibbare Enums** (settings, selectedProgram, Optionen) tragen die vollen BSH-Werte in `native.bshValues` — `shortEnum` ist verlustbehaftet, der Schreibpfad löst den short-Wert darüber zurück auf.

## Quirks / Always-Rules

- **`onUnload` synchron** — Timer clearen, `void setState`, `callback()` sofort.
- **Async-Handler** `.bind(this)` + top-level `try/catch` im Body.
- **Rate-Limit (amtlich, api-docs → Rate Limiting):** 1000 Requests/Tag + 10/s (20 Burst; dieser 429 kommt OHNE Retry-After → 60-s-Fallback-Pause) + **Token-Endpunkt eigenes Kontingent 10/min + 100/Tag** (→ Refresh-Fehlversuche mit wachsendem Backoff 30 s→30 min). Kein Polling-Sturm; der Event-Stream ist der Update-Pfad (zählt 1 Request, Stream-Nachrichten zählen nicht), ein `CONNECTED`/`PAIRED`-Event triggert den Re-Sync eines Geräts (kein Poll-Intervall).
- **API-Boundary-Type-Guards** — `isRecord`/`numberOrUndef`/`stringArrayOrUndef` vor Zugriff auf externe Daten.

## Tests

vitest, Tests neben Source unter `src/**/*.test.ts` — die reinen Bausteine (oauth, http, value-transformer, command-dispatch, sse-parser, log-dedup, pure-helpers) und die beiden extrahierten Orchestratoren (auth-controller, appliance-sync — je über Fake-Port + injizierte Timer/Uhr) sind unit-getestet; `main.ts` ist nur noch Verdrahtung + REST-Transport, den Rest deckt der Boot-Test ab. Externe API-Werte werden an der Grenze type-guarded.

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
