# <img src="https://cdn.jsdelivr.net/gh/krobipd/ioBroker.homeconnect@main/admin/homeconnect.svg" width="48" align="top" /> ioBroker.homeconnect

**Release:** [![npm version](https://img.shields.io/npm/v/iobroker.homeconnect)](https://www.npmjs.com/package/iobroker.homeconnect) ![stable](https://iobroker.live/badges/homeconnect-stable.svg) ![Installations](https://iobroker.live/badges/homeconnect-installed.svg) [![npm downloads](https://img.shields.io/npm/dt/iobroker.homeconnect)](https://www.npmjs.com/package/iobroker.homeconnect)

**Build:** [![Test and Release](https://github.com/krobipd/ioBroker.homeconnect/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/krobipd/ioBroker.homeconnect/actions/workflows/test-and-release.yml) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Support:** [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

Control and monitor your Bosch, Siemens, NEFF and Gaggenau home appliances through the official [Home Connect](https://www.home-connect.com/) cloud API — dishwashers, washers, dryers, ovens, fridges, coffee makers and more. Every value comes through in a form you can use directly, updates live, and programs can be selected, configured and started from ioBroker.

---

## Features

- **All appliance data** — status, settings, events, the active and selected program, and program options, each as an idiomatic ioBroker state.
- **A stable, complete tree** — every data point is created upfront (the event catalog of the appliance type, the options of **all** its programs) and none ever disappears: a switched-off appliance reports less, but loses nothing.
- **Live updates** through a single Home Connect event stream, so changes on the appliance show up within seconds — no polling storm.
- **Full control** — switch settings, select a program, set its options, and start, stop, pause or resume it.
- **Idiomatic values** — on/off as booleans, fixed choices as readable names with a states list, measurements as numbers with their unit and limits.
- **Encrypted login** — the OAuth token is stored encrypted and refreshed automatically; you sign in once.
- Works with Bosch, Siemens, NEFF and Gaggenau appliances (dishwashers, washers, dryers, ovens, fridges, coffee makers and more).

## Requirements

- Node.js >= 22
- js-controller >= 7.2.2
- Admin >= 8.0.11 (the sign-in panel in the settings needs Admin 8)
- A free Home Connect developer account (for a Client ID and Client Secret)

## Configuration

Home Connect requires a developer application (Client ID + Client Secret). This is free and takes a few minutes.

1. Sign in at [developer.home-connect.com](https://developer.home-connect.com) with the **same account** you use in the Home Connect app.
2. Go to **Applications → Register Application** and fill in:
   - **OAuth Flow:** `Device Flow`
   - **Application ID:** any name, e.g. `ioBroker`
   - **Success Redirect:** any URI, e.g. `https://example.com`
   - **Home Connect User Account for Testing:** leave empty
3. Save. Copy the generated **Client ID** and **Client Secret** into the adapter settings and save again — the settings page has a button that takes you straight to the portal's application list (that is also where you look up the Client Secret of an existing application).
4. A one-time **sign-in link** appears right in the adapter settings (and as a notification, and in the log). Open it, sign in with your Home Connect account and confirm — the panel switches to **signed in** once it is done.
5. **Test connection** in the same panel asks the running adapter to make a real request to Home Connect and shows what it found: how many appliances the account lists, how many are connected right now, and whether live updates are connected — or the exact reason when something is wrong (a rejected login, an unreachable service, a rate-limit pause).

The adapter stores the login **encrypted** and reconnects automatically; the sign-in survives adapter and version updates, so you only do it once.

## Updating from 1.6.x

The update takes care of itself: your sign-in and Client ID are kept, and the old raw object tree is removed automatically — every appliance reappears under a clean device folder (named by its type plate's E-number, with the name from the app as display name). Two things to know:

1. Enter your application's **Client Secret** once in the adapter settings — the previous adapter never asked for it. If your Home Connect application was created without a secret, register a new application (see above); the sign-in panel then guides you through a one-time sign-in.
2. Point your scripts and visualization at the new readable data points listed below — that cleaner tree is the whole point of this generation.

## Data points

At instance level:

| Data point | Contents |
|---|---|
| `info.connection` | Whether the adapter is signed in **and** its live event stream is connected — only then do values flow |
| `auth.signedIn` | Whether the adapter holds a usable Home Connect login (the settings panel uses it to tell "signed in, live updates down" from "not signed in") |
| `info.devicesTotal` | How many appliances are paired with your Home Connect account |
| `info.devicesOnline` | How many of them are connected right now |
| `info.devicesAllOnline` | True only while every appliance is connected — note that household appliances are switched off most of the time, so this is a "everything is running" display rather than an alarm source |

Each paired appliance appears under a device folder named by the E-number from its type plate (e.g. `sx87tx02ce-60`) — the one identifier that never changes and tells you the exact model, even with two appliances of the same kind. The name from your Home Connect app shows next to it as the display name and follows renames live. Two appliances of the identical model are told apart by a serial-based suffix. Each device has these channels:

| Channel | Contents |
|---|---|
| `info.reachable` | Whether the appliance is currently connected to Home Connect — this is what puts the green/grey dot on the device in the object browser |
| `status.*` | Read-only state: operation state (plus the derived boolean `programRunning`), the door as booleans (`doorOpen`, `doorLocked` on appliances whose door locks, one `door…Open` per compartment on refrigeration appliances), remote control, battery … |
| `settings.*` | **Writable** device settings: power state, child lock, temperatures, lighting … |
| `events.*` | Boolean event flags, created upfront from the appliance type's catalog: program finished/aborted, salt/rinse low, door alarm, descaling due … |
| `programs.selectedProgram` | The selected program — **writable** dropdown of the available programs (appliances without programs get no `programs` channel at all) |
| `programs.activeProgram` | The running program (read-only, empty when idle) |
| `programs.start` / `programs.stop` | **Buttons** — start the selected program / stop the active one |
| `options.*` | **Writable** program options: temperature, spin speed, delayed start … — the union across **all** programs, created upfront; an option that does not belong to the currently selected program is simply not sent |
| `commands.*` | **Buttons** — pause, resume, open door, acknowledge event |

Values arrive in their natural form: on/off as `boolean` switches, fixed choices as short readable names with a states list, and measurements as numbers with their unit and limits.

Every data point carries a readable **name**: the localized text Home Connect itself uses for it, in your ioBroker system language. Where the cloud sends none — events are never listed by the API, and a program option is only named while the appliance is switched on — the adapter names it itself in all eleven ioBroker languages, as it does for its own structure (channels, the online marker, the start/stop buttons, the door and running indicators). The **description** explains what the data point means; it is never the manufacturer's key, and it stays empty where the adapter has nothing to explain. The adapter owns its data points — names, descriptions and structure — and keeps them current itself, on existing installations too; your own data points belong under `0_userdata`.

**Data points never come and go.** An appliance's capabilities do not change with its state — so a switched-off appliance keeps every data point, even though it reports only a subset (often just `powerState`) while in standby. The only thing that removes data points is removing the appliance from your Home Connect account: **an appliance you remove is removed here too**, with its whole subtree — it can no longer be addressed, so its data points could never update again. Removing only ever happens after the adapter has successfully read the appliance list, so a network hiccup can never wipe your tree.

The adapter is also frugal with the cloud: program option definitions are fetched **once** per program and remembered (across restarts, inside the device object) — a program change or reconnect costs no extra requests.

While the adapter is stopped, every appliance shows as not reachable and `devicesOnline` drops to `0` — `devicesTotal` keeps its value, because how many appliances you own does not change because the adapter is off.

## Usage

1. Choose a program under `programs.selectedProgram`.
2. Adjust any `options.*` you want (e.g. temperature or delayed start).
3. Write `true` to `programs.start` to start it.

Stop with `programs.stop`, pause and resume through the `commands.*` buttons. Settings and options are written straight back to the appliance; if the appliance rejects the options for a start, the program is started with its defaults instead. Everything else keeps itself up to date through the live event stream.

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### 1.21.0 (2026-09-17)

- Fixed: the error code list of an appliance now carries a translated name and an explanation instead of an English label derived from its identifier.
- Fixed: a data point's selection list no longer keeps values the appliance stopped offering after the cloud answered without them once.

### 1.20.0 (2026-09-15)

- Fixed: a short cloud hiccup while reading the selected or active program no longer marks the appliance as having no program and no longer blocks option writes.
- Fixed: stopping the adapter while it is still reading the appliances no longer leaves some of them shown as online while the adapter is off.
- Fixed: an error during start-up was reported as a failed sign-in and could ask you for a brand-new sign-in link; it is now reported for what it is.
- Fixed: a brief network problem while you confirm the sign-in code no longer throws that code away and asks you for a new one.
- Fixed: in rare cases the adapter kept an outdated login and asked for a new sign-in after the next restart; the current login is now always the one it keeps.
- Fixed: door, running and event data points no longer turn to false when the appliance sends a message without a value; the last reading stays.
- Fixed: when the appliance rejects a change, the data point shows the appliance's real value again instead of the value that was refused.
- Improved: the adapter starts faster on large installations - it no longer reads every data point's value on every start.
- Improved: live updates resume right after you sign in again while the adapter is running, instead of waiting out a pause of up to five minutes.
- Improved: writing a setting from a script now accepts any capitalisation and the full Home Connect value, such as "On" or the complete key.
- Improved: a large installation no longer risks a one-minute cloud pause during a cold start; the adapter now paces its requests to the Home Connect limit.
- Improved: the sign-in page in the instance settings keeps updating when it is opened before the adapter has run for the first time.
- Changed: the data point auth.session is now named "Stored login" and explains that it holds the encrypted account login.

### 1.19.1 (2026-09-14)

- Fixed: the appliance pictograms of 1.19.0 were invisible in the dark Admin themes. They now follow the theme and read everywhere; existing devices get the corrected icon on the first sync.

### 1.19.0 (2026-09-12)

- New: every appliance now carries a pictogram of its type in the object tree - dishwasher, oven, washing machine and fourteen more, drawn to read in the light and the dark theme.

### 1.18.2 (2026-09-12)

- Fixed: six data points of the extended Home Connect data access - the lifetime counters and the detergent drawer event - showed an English label and no description. They are named and explained now.

## License

The MIT License (MIT)

Copyright (c) 2019-2026 TA2k <tombox2020@gmail.com>  
Copyright (c) 2024-2026 iobroker-community-adapters <iobroker-community-adapters@gmx.de>  
Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---

_Developed with assistance from Claude.ai_
