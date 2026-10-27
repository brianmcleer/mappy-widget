## 1.6.0 (2026-10-27)

- Forgive typos like a person would: swapped, neighbouring, doubled and missing letters, run-together and split words, and shorthand. Words snap to command words, then names in the app, then map words, then everyday English; known words, quoted text, numbers, conditions and search values are protected. Mappy says how he read a fixed request.
- Read with a language pack (everyday words, synonyms, other phrasings, known misspellings) built from Open English WordNet and reported phrases. A weekly GitHub Action rebuilds it, tests it against the phrase test set and the regression suites, and opens a pull request only when Mappy understands more.
- Settings, Language: get the newest pack (saved with the app, no rebuild), go back to the built-in pack, and report a missed phrase.
- Add an optional MCP server connection (Streamable HTTP): list tools, pick and fill a tool from plain words, ask first before tools that could change data, show results as text, tables, pictures and a Zoom there button, and offer the server when stuck. Settings, MCP server: address, sign-in (none, ArcGIS user, header key), per-tool choices.
- Read typos that spell real words by choosing the reading that makes the most sense ("lose the legend", "lost layers", "only sow parcels"), sound-alikes ("elevashun", "skools"), two-letter slips after a command ("zoom ot", "turn of", "turn no") and run-together words. Reads through every generated one-slip typo in the phrase test set and about nine in ten harder ones (two slips, or a missing first letter).
- When stuck, Mappy asks "Did you mean ...?" with the closest requests he can do as buttons ("zmo in" offers "zoom in", "hlo" offers "hello").
- Numbers in words and other ways to say transparency: "set parcels opacity to fifty percent", "make parcels 75 percent transparent", "fade the parcels", "make zoning solid".
- Add "turn on all layers" / "turn everything on" (pick-one groups left alone; asks first above 25 layers).
- Settings, Behavior: Fix typos switch (turn off for apps used mostly in other languages). Try it shows how a request was read.
- MCP: inputs a request leaves out, or calls "here" / "this area", come from the map (center, zoom, extent); "Use ArcGIS Location Services (beta)" fills in Esri's hosted MCP server; pictures from tools show in the bubble.
- Real words and place names are never "fixed": every English word in Open English WordNet counts as known (a compact filter in the language pack), unknown words only snap to command words, app names and map words, values and names never take shorthand fixes, non-ASCII words are left alone, and a request mostly in another language is left as typed.
- MCP: tools whose names say they change data ("deleteFeatures", "apply_edits") always ask first; tool and choice names from a server can no longer slow or break input filling; answers sent as a stream that stays open are read as soon as they arrive; the protocol version the server chooses is used; "use ..." requests fall back to the app when the server is offline.
- Language pack versions compare as numbers ("2026.11.02.10" is newer than ".9").
- Fixed: a turned-off layer showed two Undo buttons.
- The typo reader is built while the page is idle and shares its word index, so answers stay fast.
- Add `tests/typos.cjs` and `tests/mcp.cjs`; `npm test` runs all three suites.

## 1.5.0 (2026-10-27)

- Add metadata-backed null-completeness reports with one aggregate query for up to twelve fields.
- Retain filters and extent, label empty datasets, and reject partial or inconsistent statistics.
- Add safe drill-down actions and an Explore data entry; distinguish null counts from blank values and record accuracy.

## 1.4.2 (2026-10-27)

- Add contextual table sorting with natural directions, field aliases and reverse-order follow-ups.
- Preserve filters, extent and stable ordering across table pages; add natural paging shortcuts.
- Validate sorting capabilities and avoid expanding ranked or aggregate results into unrelated records.

## 1.4.1 (2026-10-27)

- Continue ambiguous layer requests through natural numbered replies or exact layer paths.
- Bind selected layers without rewriting field names or search values; preserve undo and reject stale choices.
- Support cancellation and clarify asynchronous scoped searches; never resume trailing steps silently.

## 1.4.0 (2026-10-27)

- Add guided data exploration with runnable questions derived from actual field metadata and query capabilities.
- Add numeric, category, coded-value, table and view-count ideas without querying records until selected.
- Include Explore data in the starter suggestions and command guide; respect hidden layers and disabled queries.
- Add regressions for generated question execution and capability-aware suggestions.

## 1.3.3 (2026-10-27)

- Add natural filter/ranking phrases, inclusive numeric ranges, and validated thousands separators.
- Preserve quoted names and literal values when parsing filter delimiters.
- Carry filtered-query conditions and extent into matching-count and table follow-ups; suggest next questions.
- Report ranked subset counts accurately and clear stale verbal result choices after failed queries or Clear results.

## 1.3.2 (2026-10-27)

- Support city refinements after address searches, including unsuccessful lookups, and full-address corrections.
- Understand natural candidate selections such as “the second one” and “use number 2”.
- Preserve address choices through courtesy replies; expire them after topic and map changes.
- Add multi-turn regression coverage for corrections, selection, and request limits.

## 1.3.1 (2026-10-26)

- Route natural address/place prompts through configured ArcGIS locators with metadata-defined input fields and existing authentication.
- Preserve source restrictions, rank candidates, support ordinal follow-ups, and reject stale results after map changes.
- Keep named-layer searches scoped, preserve view-count follow-ups and protect literal filter values from context substitutions.
- Recognize the built-in arcgis-map widget during automatic map selection.

## 1.3.0 (2026-10-26)

- Automatically initialize knowledge and select an unambiguous map; collapse advanced controls and unify refresh.
- Add ranked/filtered summaries and visibility troubleshooting from live layer metadata.
- Add four idle character routines, talking animation, and browser-owned desktop floating with return-to-app cleanup.

- Replace the EB-folder picker with a one-click, build-generated installed-widget help pack.
- Select, expand, reveal and enable layers through Map Layers Custom 1.50.2.
- Browse and page table rows, export displayed rows as CSV, and support conversational follow-ups.
- Include standalone tables, contextual suggestions, and additional query and export regressions.

## 1.2.0 (2026-10-26)

- Add local conversation context, up to five sequential commands, and 20-step layer visibility/opacity undo.
- Add metadata-validated conditional searches, numeric summaries, grouped counts, view scope, source details and result tables.
- Add coordinates/scale commands, diagnostics, Explore, New chat and Save chat controls.
- Ask users to choose ambiguous layer names; stop command sequences on errors or clarification.
- Fix view-count parsing, transparency inversion, numeric-ID searches, stale scan precedence and map lifecycle cleanup.
- Prevent concurrent chat actions; keep context across knowledge refreshes; discard old-map result clicks.
- Make telemetry explicitly opt-in and document network dependencies accurately.
- Add dependency-free regression tests using the host TypeScript compiler.
# Changelog

## 1.1.1 (2026-10-26)

- Fixed: when a group and a layer share a name (a map service "Parcels" holding a "Parcels" sublayer), Mappy picked the group, so the layer stayed off and the group row flashed. He now picks the layer (say "group" to mean the group), and a group that only wraps one layer stands for that layer.
- Changed: opening the layer list for a layer change no longer outlines the whole widget; only the layer's row is highlighted.
- Changed: ArcGIS documentation answers are told in Mappy's own words with numbered steps inside the bubble; no links out to Esri's site.

## 1.1.0 (2026-10-26)

- **Works through the layer list.** Mappy finds the app's layer list (Map Layers, Map Layers Custom or any widget whose folder name says layer list) and, when it publishes the layer list bridge (Map Layers Custom 1.50.0 and later), sees layers exactly as it shows them: hidden rows left out, display names, groups at any depth. Turning a layer on also turns on every group above it; a group with nothing on inside gets its layers turned on (only the top one in a pick-one group). After a change he opens the list, expands the groups, flashes the row and points at it. Without the bridge he walks the map himself with the same rules.
- **Only sees what is drawing.** Feature search, counts, fields and layer facts use only layers that are on with every group above them on. Ask about an off layer and he says so and offers to turn it on. Deep-scan facts for off layers are set aside until the layer is turned on.
- New layer commands: list layers as a tree (on, off, hidden by a group, out of scale), "only show X" (solo), "turn everything off", "where is the X layer" (reveal), "open the layer list", presets ("list presets", "apply the X preset"), starred layers. Out-of-scale layers get a "Zoom so it draws" button.
- **ArcGIS documentation.** Plain-language help for 44 out-of-the-box widgets, written from Esri's Experience Builder documentation, built in. "Pull ArcGIS documentation" in settings (and the deep scan) adds it for the widgets the app uses, under the app's own names, told in Mappy's own words (no links out to Esri). "How do I..." answers about a tool now include its how-to.
- **Help guides.** The deep scan reads help guide pages the app embeds or links to (one fact per heading, follows the guide's own pages on the same site). "Scan help files" reads a folder of saved guide pages for sites the builder cannot read. The EB folder scan now groups each widget's in-widget help guide into its topics and can open that widget's own help guide.
- **The bubble always stays in the tab.** Placement tries above, below, then beside him, caps the height to the room there and scrolls inside, clamps to the tab edges, follows him while dragged, and re-places on resize, zoom and the mobile keyboard. He is clamped inside the tab too.
- **More nostalgia.** Right-click menu (Animate!, a tip, move to the other corner, pause animation, read answers aloud, tips on or off, hide), light bulb when he has a tip, answers that type themselves out, unfold and fold-up entrances, points and looks at what he opened, leans in to listen while you type, nods, double-click to animate.
- **WCAG 2.2 AA.** Character is a real button with expanded state and a keyboard hint; Shift+F10 menu (ARIA menu pattern); arrow keys move him and Home resets (no dragging needed); Alt+Shift+M jumps to him from anywhere; bubble is a labelled non-modal dialog, Esc closes and returns focus; answers announced once through a status region; layer rows carry words, not just symbols; 28 px targets; checked contrast for text, borders and focus in both bubble styles (theme colors that fail fall back); rem sizes; reflow at 320 px; pause animation, reduced motion and forced colors respected; tips no longer pop up and close on a timer.

## 1.0.0 (2026-10-26)

- First release. Folded-map assistant for any Experience Builder 1.21 app.
- Reads the whole app at run time: pages, windows, views, widgets and where they live, text, links and contact emails.
- Reads the connected map at run time: layers, sublayers, tables, fields, coded values, bookmarks, basemap.
- Builder deep scan: web maps, layer and table services, portal items, widget manifests, stored with the app.
- Builder folder scan (Edge, Chrome): custom widget README sections, docs guides and in-widget help text.
- Author FAQ and notes with top priority.
- Actions: open and close widgets (with page, view, window and controller navigation and a pulse outline), layer on and off, opacity, zoom to layer, bookmark or home, count, feature search with highlight and popup.
- Character: pointer-following eyes, blink, moods, drag and remembered position, classic or theme bubble, tips and nudges, keyboard and screen reader support.
- Beacon usage telemetry.


