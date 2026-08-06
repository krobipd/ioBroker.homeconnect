# <img src="https://cdn.jsdelivr.net/gh/iobroker-community-adapters/ioBroker.homeconnect@master/admin/homeconnect.svg" width="48" align="top" /> ioBroker.homeconnect

**Release:** [![npm version](https://img.shields.io/npm/v/iobroker.homeconnect)](https://www.npmjs.com/package/iobroker.homeconnect) ![stable](https://iobroker.live/badges/homeconnect-stable.svg) ![Installations](https://iobroker.live/badges/homeconnect-installed.svg) [![npm downloads](https://img.shields.io/npm/dt/iobroker.homeconnect)](https://www.npmjs.com/package/iobroker.homeconnect)

**Build:** [![Test and Release](https://github.com/krobipd/ioBroker.homeconnect/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/krobipd/ioBroker.homeconnect/actions/workflows/test-and-release.yml) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**Support:** [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

Control and monitor your Bosch, Siemens, NEFF and Gaggenau home appliances through the official [Home Connect](https://www.home-connect.com/) cloud API — dishwashers, washers, dryers, ovens, fridges, coffee makers and more. Every value comes through in a form you can use directly, updates live, and programs can be selected, configured and started from ioBroker.

---

## Features

- **All appliance data** — status, settings, events, the active and selected program, and program options, each as an idiomatic ioBroker state.
- **Live updates** through a single Home Connect event stream, so changes on the appliance show up within seconds — no polling storm.
- **Full control** — switch settings, select a program, set its options, and start, stop, pause or resume it.
- **Idiomatic values** — on/off as booleans, fixed choices as readable names with a states list, measurements as numbers with their unit and limits.
- **Encrypted login** — the OAuth token is stored encrypted and refreshed automatically; you sign in once.
- Works with Bosch, Siemens, NEFF and Gaggenau appliances (dishwashers, washers, dryers, ovens, fridges, coffee makers and more).

## Requirements

- Node.js >= 22
- js-controller >= 7.2.2
- Admin >= 7.8.23
- A free Home Connect developer account (for a Client ID and Client Secret)

## Configuration

Home Connect requires a developer application (Client ID + Client Secret). This is free and takes a few minutes.

1. Sign in at [developer.home-connect.com](https://developer.home-connect.com) with the **same account** you use in the Home Connect app.
2. Go to **Applications → Register Application** and fill in:
   - **OAuth Flow:** `Device Flow`
   - **Application ID:** any name, e.g. `ioBroker`
   - **Success Redirect:** any URI, e.g. `https://example.com`
   - **Home Connect User Account for Testing:** leave empty
3. Save. Copy the generated **Client ID** and **Client Secret** into the adapter settings.
4. Start the adapter. A verification link appears in the log and in the state `homeconnect.0.auth.verificationUrl`. Open it, sign in with your Home Connect account and confirm.

The adapter stores the login **encrypted** and reconnects automatically; the sign-in survives adapter and version updates, so you only do it once.

## Data points

Each paired appliance appears under a readable device name (e.g. `dishwasher`), with these channels:

| Channel | Contents |
|---|---|
| `status.*` | Read-only state: operation state, door, remote control, battery … |
| `settings.*` | **Writable** device settings: power state, child lock, temperatures … |
| `events.*` | Boolean event flags: program finished, salt/rinse low, door alarm … |
| `programs.selectedProgram` | The selected program — **writable** dropdown of the available programs |
| `programs.activeProgram` | The running program (read-only, empty when idle) |
| `programs.start` / `programs.stop` | **Buttons** — start the selected program / stop the active one |
| `options.*` | **Writable** program options: temperature, spin speed, delayed start … |
| `commands.*` | **Buttons** — pause, resume, open door, acknowledge event |

Values arrive in their natural form: on/off as `boolean` switches, fixed choices as short readable names with a states list, and measurements as numbers with their unit and limits.

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
### 1.7.0 (2026-08-06)

- Complete rewrite. Every value now arrives ready to use: on/off as switches, fixed choices as readable names, and temperatures and times as numbers with their unit.
- Programs, status and events update live through a single connection, so changes on the appliance show up in ioBroker within seconds instead of on a poll.
- Full program control: select a program, set options such as temperature, spin speed or delayed start, then start, stop or pause it from ioBroker.
- Every data point now has a short, readable name, so appliance values are easy to find and use in scripts, charts and visualisations.

### 1.6.1 (2026-05-12)

- (TA2k) Login/Refresh flow improved

### 1.6.0 (2026-05-11)

- (copilot) Adapter requires node.js >= 22 now
- (copilot) Adapter requires admin >= 7.7.22 now
- (Lucky-ESA) Fixed adapter crash if URI is empty
- (Lucky-ESA) Save remaining time in active folder
- (Lucky-ESA) Device monitoring starts only after the adapter has started (this may take up to 2 minutes)

### 1.5.2 (2025-12-14)

- (Lucky-ESA) Rate limit of 50 requests per minute intercepted at adapter startup
- (Lucky-ESA) Added custom request

### 1.5.1 (2025-09-20)

- (Lucky-ESA) Fixed: Name of the objects are deleted

[Older changelogs can be found there](CHANGELOG_OLD.md)

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
