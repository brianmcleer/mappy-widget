# Mappy

A friendly folded-map assistant for any ArcGIS Experience Builder app. Drop him into an experience and he floats over the page, waves hello, and answers questions about everything in that app: its pages, views and windows, every widget (what it does and where it lives), the text and links configured in it, every layer and field on the map, and the answers you type in yourself. He can also do things: open a widget (walking the user to the right page, view, window or toolbar first), switch layers on and off, zoom, count features and find features by name, address or id.

Discussion, questions and ideas: [Mappy on Esri Community](https://community.esri.com/en/discussion/1722041/mappy-a-clippy-style-assistant-for-experience-builder). Bugs and missed phrases: [GitHub issues](https://github.com/brianmcleer/mappy-widget/issues).

He works in any app with no setup. A **deep scan** in the builder makes him much smarter.

The assistant runs in the browser. There is no model download, API key, outside AI service, or LLM server (an MCP server is used only if you connect one). ArcGIS map data, feature queries, manifests and optional help scans still use the app's configured services. Telemetry is off by default and requires explicit opt-in. This is a local command and retrieval assistant, not a general-purpose language model or a fully offline map.

**New in 1.9:** a guided tour ("show me around" walks the app's tools one at a time, pointing at each), "what did I change" (everything he did to the map, with undo), "try again" after a server hiccup, "what did I click" (the feature under an open popup, as a table), suggestions as you type (Tab takes the first), a light bulb with ideas when a popup opens, and a Preview section in settings to see any of the 80 outfits and 30 acts now.

**New in 1.8:** a plain-language glossary ("what is an easement", "what does R-4 mean"), questions about places ("who owns 250 N 5th St", "closest hydrant to my address", "directions to City Hall"), layers by name ("where are the parks"), labels, basemaps, "go back", comparisons of two addresses, kind pointers for things a map cannot answer, a resizable, draggable chat that survives a reload, an outfit for 80 days of the year (hat, hand, feet and a buddy; "why the pumpkin"), the Clippy pack of little performances (gears, paper airplane, bike ride, wizard hat, a knock on the glass for tips, optional sound effects), and a "Your place" setting with local fun facts built from Wikipedia, so nothing in him is tied to one town. See [the changelog](CHANGELOG.md).

**New in 1.6:** forgives typos like a person would ("trun on parcles", "lsit layres", "zoomin"), reads with a language pack that a GitHub Action improves every week (pull it in settings, no rebuild), and can use the tools of an MCP server you connect (ArcGIS Location Platform MCP, a portal MCP server or your own). See [Language](#language-always-improving) and [MCP server](#mcp-server-optional).

**New in 1.3:** automatic initial setup, one refresh button, layer selection/expansion, paged tables and CSV, ranked and filtered summaries, visibility troubleshooting, additional character routines, and desktop floating in browsers supporting Document Picture-in-Picture. See [the local assistant guide](docs/local-assistant.md) for examples and limits.

## Features

- **Knows the whole app, not just widgets.** Reads the live app config: app title and description, pages (including menu links), windows (including the splash), sections and views, every placed widget, the text in Text, Button, Image and Embed widgets, and every useful link and contact email anywhere in the app.
- **Knows the map.** Reads the connected map's operational layers, sublayers, tables, fields, coded value lists, bookmarks and basemap at run time.
- **Deep scan (builder).** One click reads each web map (summary, description, tags, credits, bookmarks, basemap), every layer and table service behind it (descriptions, every field and alias, every coded value), the portal items behind the layers, standalone service data sources, and every widget's manifest. The result is stored with the app, so users get it instantly.
- **Automatic installed help.** Initial setup and Refresh app knowledge include the locally bundled help pack. No directory picker or browser filesystem access. The pack is generated when Experience Builder builds.
- **Your answers.** Add questions and answers, and free-form notes, in the settings panel. These outrank everything he finds on his own.
- **Takes action.** Opens widgets in controllers, sidebars, views and windows and pulses an outline around them; switches pages, views and windows; turns layers on and off (and their parent groups); sets opacity; zooms to layers, bookmarks and the starting view; counts features (all or in view); searches features with smart field picking and opens the popup on a match.
- **Understands people.** Ranked retrieval (BM25) with GIS synonyms (parcel, property, lot...), light stemming, prefix matching and typo tolerance, plus intent rules for commands ("turn on zoning", "find 123 Main St", "what's in hydrants", "how many parcels in view").
- **Personality.** Eyes follow the pointer, he blinks, waves, thinks, searches with a magnifier, celebrates, dozes off when ignored, and tells (bad) map jokes. Optional "Did you know?" tips and a "looks like you're hunting for something" nudge after lots of panning. Users can stop tips with one click.
- **Draggable**, remembers where the user put him, classic yellow bubble or the app's theme colors, three sizes, either corner, floating over the app or inside the widget box.
- **Accessible.** Keyboard operable, labeled controls, polite live region for answers, respects reduced motion.

## Layers, the way the layer list shows them

- Mappy works through the app's layer list. With **Map Layers Custom 1.50.0 or later** he reads the tree from it (hidden rows left out, display names, groups at any depth) and changes layers through it; after a change he opens the list, expands the groups, flashes the row and points at it. With another layer list he points at it and switches the map himself with the same rules. Turn this off with **Work through the layer list**.
- Turning a layer on turns on every group above it. Turning on a group with nothing on inside turns on its layers (the top one only in a pick-one group).
- He only looks inside layers that are drawing: on, with every group above them on. Ask about an off layer and he offers to turn it on.
- Commands: "list layers", "what layers are on", "turn on X", "turn off X", "only show X", "turn everything off", "where is the X layer", "open the layer list", "list presets", "apply the X preset", "my favorite layers", "set X opacity to 50%".

The bridge contract (`window.__exbLayerLists`, event `exb-layer-list-change`) is documented in Map Layers Custom's `src/runtime/lib/layer-bridge.ts`; any layer list can publish it.

## Language, always improving

- **Forgives typos.** Before reading a request Mappy fixes slips: swapped letters, neighbouring keys, doubled or missing letters, run-together and split words, shorthand ("pls", "teh"). Words snap to command words, names in this app (layers, tools, fields) and map words, never to other everyday English. Real English words (all of Open English WordNet) are never changed, so place and road names like "Mesa County", "Elm Ave" or "Canyon View" stay as typed; a request mostly in another language is left alone too. Other words he knows are never changed, and values are protected: quoted text, numbers, anything after "where" or "equals", and the thing being searched for ("find Smith in parcels") only snaps to names in the app. When he fixes something he says how he read it.
- **Language pack.** Everyday words, synonyms, other phrasings and known misspellings, built from Open English WordNet (CC BY 4.0) and from phrases people report. A GitHub Action rebuilds it weekly, tests every change against the phrase test set and the regression suites, and opens a pull request only when Mappy understands more. Pull the newest pack in **Language**, **Get language updates** (saved with the app, no rebuild), with `git pull`, or with `node language/sync.mjs <widget folder>`. Details: [language/README.md](https://github.com/brianmcleer/mappy-widget/blob/HEAD/language/README.md).
- **Reads in context.** A typo that spells a real word ("lose the legend", "lost layers") is read the way that makes sense in this app; sound-alikes ("elevashun") and two-letter slips after a command ("zoom ot", "turn of") work too. Turn it off in **Behavior**, **Fix typos** for apps used mostly in other languages.
- **Asks when unsure.** When a request still makes no sense he asks "Did you mean ...?" with the closest requests he can do as buttons, the way Clippy asked "It looks like you're ...".
- **Teach him.** **Language**, **Teach Mappy a phrase** opens a short GitHub report; the next weekly build learns it.

## MCP server (optional)

A second way for Mappy to help: connect a Model Context Protocol server in **MCP server** settings and he can use its tools, such as ArcGIS Location Platform's MCP (geocoding, routing, elevation, static maps) or a portal MCP server. He picks the tool and fills it in from what was typed (still no language model), shows the answer as words, a table, a picture or a **Zoom there** button, and asks first before any tool that could change data. Say "list server tools", "ask the server where is 250 N 5th St", "elevation here", or "use route from City Hall to the library"; "here" and "this area" mean the map as it is now. **Use ArcGIS Location Services (beta)** fills in Esri's hosted server; add an API key. Setup, CORS and safety: [docs/mcp.md](docs/mcp.md).

## Help guides and ArcGIS documentation

- **Pull ArcGIS documentation** (settings, also part of the deep scan): plain-language help for the out-of-the-box widgets the app uses, written from Esri's Experience Builder documentation and built into Mappy (no network). Mappy tells it in his own words inside the bubble; users are never sent to Esri's site.
- **Help guide pages** (deep scan): pages the app embeds (Embed widgets) or links to with a help-like name are read one heading at a time, plus the guide's other pages beside them. Sites that do not allow the builder to read them are listed in the scan log.
- **Scan help files**: pick a folder of saved guide pages (.html, .md, .txt) for those sites.
- **Learn installed widgets**: imports README sections, guides and in-widget help; answers can open the matching widget or its help.

## Keyboard and accessibility (WCAG 2.2 AA)

| Key | Does |
| --- | --- |
| Alt+Shift+M | From anywhere: show Mappy, open the chat, put the cursor in the question box |
| Enter or Space on Mappy | Open or close the chat |
| Shift+F10 or the menu key on Mappy | His menu (Animate!, tip, move, pause animation, read aloud, tips, hide) |
| Arrow keys on Mappy | Move him 16 px (Shift: 64 px); Home puts him back |
| Esc in the bubble | Close it and return to Mappy |
| Up and Down in the question box | Earlier questions |

The bubble is a labelled non-modal dialog that always stays inside the browser tab; answers are announced once to screen readers; status symbols in layer lists come with words; every control is at least 28 px; text, borders and focus rings meet contrast in both bubble styles; motion stops with Pause animation or the system's reduced motion setting; forced colors are respected.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.21 (Maps SDK 5.x).
- A Map widget in the app for the map features (optional; app knowledge works without one).
- Edge or Chrome only for the optional saved-help-files folder import.

## Install

1. Download the release zip and extract it.
2. Place the `mappy` folder directly inside your Experience Builder client extensions folder:

   ```
   client\your-extensions\widgets\mappy\
   ```

   `manifest.json` must sit **directly inside** that folder. Do not nest it a second level deep (for example `widgets\mappy\mappy\`). Nesting is the most common cause of a widget not registering.
3. From the Experience Builder `client` folder (Command Prompt, regular), install dependencies:

   ```
   pnpm ci
   ```

   Mappy has no third-party dependencies. Do not run `npm install` inside the widget folder on Experience Builder 1.21.
4. Start (or restart) Experience Builder (Command Prompt, regular):

   ```
   pnpm start
   ```
5. The widget appears in the builder under **Custom**.

## Set up in an app

1. Drag **Mappy** anywhere onto the page. The box itself only shows a one-line note; Mappy floats in the corner over the whole app when it runs. A small spot in the header or footer works well. You can also put him in a Widget Controller, so users summon him from the toolbar.
2. Optional: pick the map in **Map**. Without a choice he uses the first map in the app.
3. Initial setup starts automatically. If the app has exactly one map, Mappy selects it for you. Use **Refresh app knowledge** after changing the map or app. Detailed controls are under Advanced knowledge options.
4. Click **Learn installed widgets**. Mappy imports the bundled installed-widget help immediately; keep Only widgets this app uses enabled to focus the knowledge.
5. Add your own questions and answers under **Your answers**.
6. Use **Try it** to ask what a user would ask and see his answer before you publish.

## What users can ask

| Ask | He does |
| --- | --- |
| What is this app? | Describes the app and lists its tools |
| What tools are there? / List pages / List links | Lists them, each clickable |
| Open print / Show me the legend / Launch droplets | Opens the widget, walking to its page, view, window or toolbar, and pulses it |
| How do I measure distance? | Explains the right tool and offers to open it |
| Who do I contact? | Finds contact emails and your notes |
| Turn on zoning / Hide parcels layer | Toggles the layer (and its groups) |
| Set parcels opacity to 50% | Sets opacity |
| What's in hydrants? / What zone types are there? | Lists fields, or the coded values |
| How many parcels in view? | Counts features |
| Find 123 Main St / Smith in parcels / 2945-123-00-001 | Searches features, zooms, highlights, opens the popup |
| Zoom to downtown / Zoom to full extent / Where am I? | Bookmarks, layers, home, map center |
| Who owns 250 N 5th St? / What zoning is it in? / When is trash pickup? / Is it in a flood zone? | Place questions, through the in-house GIS server or the app's own parcel layer |
| Closest hydrant to my address / Hydrants within 500 ft / Directions to City Hall | Nearest, within a distance, straight-line distance and a directions link |
| What is an easement? / What does R-4 mean? / What zoning types are there? | Plain-language meanings, the map's own code lists |
| Where are the parks? / What parks are there? / Label the parcels | The layer on and zoomed, its first names, labels |
| Which zoning has the most parcels? / Largest parcel / Parcels bigger than 5 acres | Answers first, then the table |
| Satellite view / What is the scale? / Go back / Reset the map | Basemaps from the portal, scale in plain words, the previous view |
| Compare 1718 White Ave and 250 N 5th St | Two parcels side by side |
| When was parcels updated? / Is this map accurate? | The layer's last edit and source, with a general-reference note |
| What time does City Hall close? / Do I need a permit? | A kind pointer to the right place, not a wrong answer |
| Show me around / Next / Stop tour | A guided tour of the app's tools, pointing at each one |
| What did I change? / Undo / Try again | His layer changes so far, the last one reversed, the last request run again |
| What did I click? | The feature under the open popup, as a table of its fields |
| Tell me a joke | Regrets nothing |

## Configuration

| Setting | Default | What it does |
| --- | --- | --- |
| Name | Mappy | Character name in the bubble and his lines |
| Greeting | (built in) | First line he says |
| Display | Floating | Floating over the app, or inside the widget box |
| Start corner | Bottom right | Where he starts; users can drag him |
| Size | Medium | 72, 96 or 128 px |
| Speech bubble | Classic yellow | Or the app's theme colors |
| Say hello on a first visit | On | Opens the chat once per browser |
| Tips and nudges | On, 180 s | Idle-time tips and the panning nudge |
| Search map features | On | Feature search by name, address or id |
| Most results per search | 8 | Cap on results |
| Suggestion chips | (smart) | Comma separated starter questions |
| Your answers / Notes | none | Author knowledge with the highest priority |
| Work through the layer list | On | Open the layer list and flash the row after a layer change |
| Tips appear as | Light bulb | A bulb over his head, or the bubble opens |
| Type answers out | On | Skipped under reduced motion |
| Offer "Read answers aloud" | On | Browser speech, off until the user turns it on in his menu |
| Jokes, games and holiday hats | On | Easter eggs and an outfit for 80 days of the year |
| Sound effects | Off | Synthesized pop, knock, ta-da, wobble, boing; silent under reduced motion |
| Your place: Organization | (portal org name) | "the City", "the County", "the Water District": used in his wording |
| Your place: Place name, Website | none | The town or area; the website is offered as a link when he points people off the map |
| Your place: Local fun facts | none | One per line; "Build facts from Wikipedia" fills it from the place's page and nearby landmarks (CC BY-SA) for you to prune |
| Usage telemetry | Off | Optional Beacon counts and errors (below); explicit opt-in required |

The deep scan result is stored in the widget config (capped near 900 KB; the least useful facts are dropped first on very large maps). **Clear brain** removes it.

## How it works

- `src/brain/` is plain TypeScript shared by the runtime and the settings panel: `extract.ts` and `appModel.ts` read any app config and compute where every widget lives; `layers.ts` turns REST or live layer info into facts and picks searchable fields; `engine.ts` is the ranked index; `intents.ts` parses commands; `answer.ts` and `voice.ts` write replies.
- `src/runtime/` holds the character (pure SVG), the bubble, `live.ts` (map hands), `navigate.ts` (page, view, window and widget navigation) and `mind.ts` (intent, plan, act, reply).
- `src/setting/deepScan.ts` and `folderScan.ts` build the stored brain. The settings bundle has no static `esri/*` import; `esri/request` loads on click.

## Usage telemetry

When explicitly enabled, this widget records anonymous usage counts and errors so the GIS Division can see which widgets and versions are in use and which errors users hit. It records the app id and title, widget name and version, the action name, a truncated error message, the site host name and browser family. It never records usernames, coordinates, addresses, attribute values, questions users type or URLs with query strings. Where the data goes: on page load the widget asks the app's portal for a public item tagged `exb-beacon-sink` and posts to that table. If your portal has no such item, nothing is sent anywhere. To turn it off for an app, switch off **Usage telemetry** in the settings panel (or set `"telemetry": false` in the widget's config), or users can enable Do Not Track in their browser. The shared module is `src/shared/beacon.ts`.

## Experience Builder 1.21 TypeScript editor setup (Visual Studio)

`tsconfig.json`, `src/exb-editor-shims.d.ts` (copy of the shared master) and `src/vendor-shims.d.ts` (Mappy's additions, `jimuHistory`) let Visual Studio type check the widget without reading `client\node_modules`. They are editor-only; webpack (`pnpm start` in `client`) is the type authority. `tsconfig.json` keeps `"jsx": "react-jsx"` with `"jsxImportSource": "@emotion/react"`, which the build requires. Open the widget folder itself in Visual Studio, not `client`. Quick check in the widget folder: `npx tsc -p .` reports 0 errors (TypeScript 5.6). The editor shims are left out of the release zip; a repo clone can delete them.

## Troubleshooting: `mappy is duplicated`

Experience Builder registers widgets by the `name` value in `manifest.json` and throws this error when the same name is registered more than once. A correctly placed single copy cannot duplicate itself, so a second copy is present somewhere.

Check in this order:

1. **Nested folder**: `widgets\mappy\mappy\`. The manifest must sit directly inside the widget folder, not a second level deep.
2. **Leftover folder** from an earlier build or version, including any `-copy` folder.
3. **Stale compiled build** in `client\dist\widgets\mappy\`. Stop the dev server, delete that folder, then start again.

## Troubleshooting: Mappy

- **He can't open a widget** and says where it lives instead: the widget sits in a layout container that does not respond to open requests (some sidebars). He pulses the container so users can find it.
- **"I can't see a map yet"**: no Map widget in the app, or the chosen one is not on the current page.
- **Feature search finds nothing**: the layer needs string fields worth searching (name, address, id...). Run the deep scan so he knows each layer's fields before the user asks.
- **Learn installed widgets has no pack**: rebuild Mappy inside the Experience Builder widgets folder. Saved help-file imports still require Edge or Chrome.

## License

Apache-2.0. Copyright City of Grand Junction, CO.

## Credits

Brian McLeer, GIS Division, City of Grand Junction. Inspired by the classic desktop assistant concept; the character and art are original.

