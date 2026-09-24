# ioBroker.homeconnect

Hausgeräte von Bosch, Siemens, NEFF und Gaggenau über die offizielle Home-Connect-Cloud-API steuern und überwachen — Geschirrspüler, Waschmaschinen, Trockner, Backöfen, Kochfelder, Dunstabzugshauben, Kühl- und Gefriergeräte, Kaffeevollautomaten, Saugroboter und mehr.

Jeder Wert kommt in einer Form an, mit der sich direkt arbeiten lässt: Ein/Aus als Boolean, eine feste Auswahl als lesbarer Name, ein Messwert als Zahl mit Einheit und Grenzen. Änderungen treffen live über einen einzigen Ereignisstrom ein, und Programme lassen sich aus ioBroker heraus wählen, einstellen und starten.

## Voraussetzungen

- Node.js >= 22
- js-controller >= 7.2.2
- Admin >= 8.0.11 — das Anmelde-Panel in den Einstellungen ist eine Admin-8-Komponente
- Ein kostenloses Home-Connect-Entwicklerkonto für Client ID und Client Secret

## Zugangsdaten bei Home Connect anlegen

Drei Dinge gehören zusammen: das normale Home-Connect-Konto, ein damit verlinktes Entwicklerkonto und eine darin registrierte Anwendung.

1. Man braucht das normale **Home-Connect-Konto** — das der Home-Connect-App, in dem die Geräte gekoppelt sind.
2. Auf [developer.home-connect.com](https://developer.home-connect.com) ein kostenloses Entwicklerkonto anlegen. Im Profil **Default Home Connect User Account for Testing** auf die E-Mail-Adresse des App-Kontos setzen — das verlinkt die beiden Konten, sonst sieht die Anwendung keine Geräte — und als **Account Type** `Individual` wählen.
3. Unter **Applications** eine neue Anwendung registrieren und als OAuth-Verfahren **Device Flow** wählen. Der Adapter läuft auf einem Server ohne Browser und braucht deshalb den Device Flow — ein Redirect-Verfahren funktioniert nicht. Das Feld **Home Connect User Account for Testing** der Anwendung darf leer bleiben; es gilt der Standard aus dem Profil.
4. **Client ID** und **Client Secret** in die Adapter-Einstellungen übernehmen und speichern.

## Anmelden

Nach dem Speichern der Zugangsdaten fordert der Adapter einen Anmelde-Link an. Der Link erscheint im Einstellungs-Panel; der Bestätigungscode steht in der Benachrichtigung und im Log. Link öffnen, Code eingeben, falls gefragt, Zugriff bestätigen — der Adapter merkt die Freigabe innerhalb weniger Sekunden von selbst und speichert die Anmeldung verschlüsselt.

Läuft der Link ab, erneuert er sich selbst; ein länger offenes Panel führt also nie in eine tote Adresse. Die Schaltfläche **Verbindung testen** fragt Home Connect wirklich: sie listet die Geräte, sagt wie viele davon gerade verbunden sind, und meldet, ob die Live-Updates laufen.

Angemeldet wird einmal. Der Adapter erneuert seinen Zugang selbst; nur ein im Home-Connect-Konto widerrufener Zugriff macht eine neue Anmeldung nötig.

## Der Objektbaum

Jedes Gerät bekommt einen Ordner. Sein Name ist die **E-Nummer vom Typenschild** (zum Beispiel `sx87tx02ce-60`) — sie steht auf dem Gerät, ändert sich nie und benennt das Modell eindeutig, was der Gerätename aus der App nicht tut. Der App-Name bleibt als Anzeigename des Ordners sichtbar und folgt der App live.

Unter jedem Gerät:

| Kanal      | Was darin liegt                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `info`     | `reachable` — ob das Gerät gerade mit Home Connect verbunden ist (der grün/graue Punkt am Ordner)                             |
| `status`   | Nur-Lese-Zustand: Betriebszustand, `doorOpen` / `doorLocked`, `programRunning`, Fernbedienungs-Marker                         |
| `settings` | Schreibbare Einstellungen: Betriebszustand, Kindersicherung, Innenbeleuchtung, Kühltemperaturen                               |
| `events`   | Jedes Ereignis dieses Gerätetyps als Boolean: Programm beendet, Salz fast leer, Klarspüler leer, Filter gesättigt, Türalarm … |
| `programs` | `selectedProgram`, `activeProgram` sowie die Schaltflächen `start` und `stop`                                                 |
| `options`  | Die Optionen der Programme: Temperatur, Schleuderdrehzahl, Intensivzone, Startverzögerung …                                   |
| `commands` | Momentschalter, die das Gerät anbietet, etwa das Quittieren eines Ereignisses                                                 |

Auf Instanzebene fassen `info.devicesTotal`, `info.devicesOnline` und `info.devicesAllOnline` das Konto zusammen; `info.connection` ist grün, wenn der Adapter angemeldet ist **und** die Live-Updates laufen.

Zwei Eigenschaften sind wichtig zu wissen:

- **Jeder Datenpunkt existiert ab dem ersten Start** — die Ereignisse des Gerätetyps und die Optionen _aller_ Programme, nicht nur die des gerade gewählten.
- **Kein Datenpunkt verschwindet je.** Ein ausgeschaltetes Gerät meldet der Cloud sehr viel weniger, aber das heißt nie, dass es eine Fähigkeit verloren hätte. Nur ein aus dem Home-Connect-Konto entferntes Gerät verliert seinen Ordner.

## Geräte bedienen

- **Eine Einstellung:** den Wert in den Datenpunkt unter `settings` schreiben. `"true"`, `1` und `true` funktionieren gleichermaßen — der Adapter wandelt vor dem Senden in den Typ des Datenpunkts.
- **Ein Programm starten:** in `programs.selectedProgram` wählen, die gewünschten Optionen unter `options` setzen, dann `programs.start` auf `true`. Der Adapter schickt die gewählten Optionen mit dem Start; verweigert das Gerät diese Kombination, wiederholt er einmal mit den Vorgaben des Programms.
- **Ein Programm stoppen:** `programs.stop` auf `true` setzen.
- **Einen Befehl auslösen:** die Schaltfläche unter `commands` auf `true` setzen; sie fällt von selbst auf `false` zurück.

Home Connect lässt eine Fernbedienung nur zu, wenn das Gerät es erlaubt — die meisten Maschinen brauchen dafür **Fernstart** am Gerät selbst, und viele verweigern eine Änderung, während ein Programm läuft. `status.remoteControlActive` und `status.remoteControlStartAllowed` sagen, was das Gerät gerade zulässt.

## Namen und Beschreibungen der Datenpunkte

Die eigenen Namen des Adapters gehen vor: Er benennt die Ereignisse, die üblichen Status-Werte und Einstellungen, die Programm-Optionen und seine eigene Struktur in elf Sprachen. Wo er keinen eigenen Namen hat, nimmt er den lokalisierten Namen, den Home Connect in der ioBroker-Systemsprache schickt, und zuletzt einen aus der Kennung abgeleiteten lesbaren Namen. Die Beschreibung erklärt, was ein Datenpunkt bedeutet, wiederholt nie den Herstellerbezeichner und bleibt leer, wo es nichts zu erklären gibt.

Namen und Beschreibungen gehören dem Adapter: ein Update zieht bestehende Anlagen mit, ein Baum aus einer älteren Fassung behält also keine alten Bezeichnungen. Wer eigene Benennungen will, nutzt Aliase oder eigene Datenpunkte unter `0_userdata`.

## Umstieg vom bisherigen Adapter (1.6.x und älter)

Der Adapter räumt den alten Datenbaum beim ersten Start selbst weg: die alten Roh-Ordner werden entfernt, übrig bleibt der lesbare Gerätebaum. Die Anmeldung wird übernommen.

Von Hand bleibt genau eines zu tun: **das Client Secret eintragen**. Die alte Generation kam ohne aus, es wurde deshalb nie gespeichert.

## Anfragegrenzen

Home Connect gewährt 1000 Anfragen pro Tag je Anwendung und Konto, dazu eine kurzfristige Spitzengrenze. Der Adapter ist darauf gebaut: ein dauerhafter Ereignisstrom statt Abfragen im Takt, dauerhaft gemerkte Programmdefinitionen, und eine selbsttätige Pause nach einer Grenz-Antwort. Einzustellen ist nichts — aber eine zweite eigene Anwendung mit denselben Zugangsdaten teilt sich dasselbe Kontingent.

## Fehlersuche

| Symptom                             | Ursache und Abhilfe                                                                                                                                       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info.connection` bleibt rot        | Nicht angemeldet, oder der Ereignisstrom liegt. **Verbindung testen** in den Einstellungen nennt den Grund.                                               |
| Es erscheinen keine Geräte          | Das Entwicklerkonto muss mit dem App-Konto verlinkt sein (im Profil: Standard-Testkonto = E-Mail-Adresse der App), und die Anmeldung muss bestätigt sein. |
| Der Anmelde-Link funktioniert nicht | Codes laufen nach wenigen Minuten ab. Der Adapter fordert selbsttätig einen neuen an; das Einstellungs-Panel zeigt ihn von selbst.                        |
| Ein Gerät bleibt grau               | Es ist ausgeschaltet oder ohne Netz. Seine Datenpunkte bleiben mit ihren letzten Werten stehen.                                                           |
| Ein Schreibvorgang bewirkt nichts   | Das Gerät lässt gerade keine Fernbedienung zu (`status.remoteControlActive`), oder die Option gehört nicht zum gewählten Programm.                        |
| Im Log steht „no program active"    | Das ist die normale Antwort eines untätigen Geräts, kein Fehler — sie wird auf Debug-Stufe protokolliert.                                                 |

## Unterstützung

Fragen, Fehlerberichte und Ideen: [github.com/krobipd/ioBroker.homeconnect](https://github.com/krobipd/ioBroker.homeconnect).
