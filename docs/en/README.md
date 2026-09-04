# ioBroker.homeconnect

Control and monitor Bosch, Siemens, NEFF and Gaggenau home appliances through the official Home Connect cloud API — dishwashers, washers, dryers, ovens, hobs, hoods, fridges, freezers, coffee makers, cleaning robots and more.

Every value arrives in a form you can use directly: on/off as a boolean, a fixed choice as a readable name, a measurement as a number with its unit and limits. Updates arrive live through a single event stream, and programs can be selected, configured and started from ioBroker.

## Requirements

- Node.js >= 22
- js-controller >= 7.2.2
- Admin >= 8.0.11 — the sign-in panel in the settings is an Admin 8 component
- A free Home Connect developer account, for a Client ID and a Client Secret

## Getting your Home Connect credentials

1. Create a free account at [developer.home-connect.com](https://developer.home-connect.com) and sign in.
2. Under **Applications**, register a new application.
3. Choose **Device Flow** as the OAuth flow. The adapter runs on a server without a browser, so it needs the device flow — a redirect flow will not work.
4. Register the same e-mail address you use in the Home Connect app, otherwise the application sees no appliances.
5. Copy the **Client ID** and the **Client Secret** into the adapter settings and save.

## Signing in

After saving the credentials the adapter requests a sign-in link. It appears in the settings panel, along with the code to confirm. Open the link, enter the code, and approve the access — the adapter picks the approval up on its own within a few seconds and stores the login encrypted.

The link renews itself when it expires, so a panel that has been open for a while never leaves you with a dead link. The **Test connection** button asks Home Connect directly: it lists your appliances, says how many are connected right now, and reports whether live updates are running.

You sign in once. The adapter refreshes its access by itself; only revoking the access in your Home Connect account requires a new sign-in.

## The object tree

Each appliance gets one folder. Its name is the **E-number from the type plate** (for example `sx87tx02ce-60`) — printed on the machine, unchangeable and unique per model, which the appliance name in the app is not. The appliance name from the app stays visible as the folder's display name and follows it live.

Below each appliance:

| Channel | What is in it |
|---|---|
| `info` | `reachable` — whether the appliance is currently connected to Home Connect (the green/grey dot on the folder) |
| `status` | Read-only appliance state: operation state, `doorOpen` / `doorLocked`, `programRunning`, remote-control flags |
| `settings` | Writable settings: power state, child lock, interior light, fridge temperatures |
| `events` | Every event of this appliance type as a boolean: program finished, salt nearly empty, rinse aid empty, filter saturated, door alarm … |
| `programs` | `selectedProgram`, `activeProgram`, and the `start` / `stop` buttons |
| `options` | The options of the programs: temperature, spin speed, intensive zone, delayed start … |
| `commands` | Momentary buttons the appliance offers, e.g. acknowledging an event |

At instance level, `info.devicesTotal`, `info.devicesOnline` and `info.devicesAllOnline` summarise the account, and `info.connection` is green when the adapter is signed in **and** live updates are running.

Two properties are worth knowing:

- **Every data point exists from the first start** — the events of the appliance type and the options of *all* its programs, not only of the one currently selected.
- **No data point ever disappears.** A switched-off appliance reports far less to the cloud, but that never means it lost a capability. Only an appliance you remove from your Home Connect account loses its folder.

## Operating appliances

- **A setting:** write the value into the data point under `settings`. `"true"`, `1` and `true` all work — the adapter converts to the data point's type before sending.
- **Start a program:** pick it in `programs.selectedProgram`, set the options you want under `options`, then set `programs.start` to `true`. The adapter sends the selected options with the start; if the appliance refuses that combination, it retries once with the program's defaults.
- **Stop a program:** set `programs.stop` to `true`.
- **A command:** set the button under `commands` to `true`; it falls back to `false` by itself.

Home Connect only accepts remote operation when the appliance allows it — most machines need **Remote Start** enabled on the appliance itself, and many refuse a change while a program is running. `status.remoteControlActive` and `status.remoteControlStartAllowed` tell you what the appliance currently permits.

## Data point names and descriptions

Names come from Home Connect in your ioBroker system language wherever the cloud provides them; where it does not — events, for instance, are never listed by the API — the adapter names them itself in eleven languages. The description explains what a data point means, never repeats the manufacturer's key, and stays empty where the adapter has nothing to explain.

Names and descriptions belong to the adapter: an update brings existing installations along, so a tree from an older version does not keep old labels. If you want your own naming, use aliases or your own data points under `0_userdata`.

## Updating from the previous adapter (1.6.x and older)

The adapter replaces the old data tree by itself on the first start: the old raw folders are removed, and only the readable device tree remains. Your login is carried over.

The one thing you have to do by hand: **enter the Client Secret**. The older generation worked without one, so it was never stored.

## Rate limits

Home Connect grants 1000 requests per day per application and account, plus a short-term burst limit. The adapter is built around that: it uses one persistent event stream instead of polling, remembers program definitions permanently, and pauses on its own after a rate-limit answer. There is nothing to configure — but a second application of your own using the same credentials shares the same budget.

## Troubleshooting

| Symptom | Cause and remedy |
|---|---|
| `info.connection` stays red | Not signed in, or the event stream is down. Use **Test connection** in the settings — it names the reason. |
| No appliances appear | The developer application must be registered with the same e-mail address as the Home Connect app, and the sign-in must be approved. |
| Sign-in link does not work | Codes expire after a few minutes. The adapter requests a new one automatically; reload the settings page. |
| An appliance stays grey | It is switched off or has no network. Its data points stay and keep their last values. |
| A write does nothing | The appliance permits no remote operation right now (`status.remoteControlActive`), or the program option does not belong to the selected program. |
| Log says "no program active" | That is the normal answer of an idle appliance, not an error — it is logged at debug level. |

## Support

Questions, bug reports and ideas: [github.com/krobipd/ioBroker.homeconnect](https://github.com/krobipd/ioBroker.homeconnect).
