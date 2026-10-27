# Mappy local assistant guide

## Added in 1.5: missing-value reports

Ask `what's missing in parcels?`, `check data quality for parcels`, or `check missing values in parcels in view`. Conditions also work: `check data quality for parcels where status equals Active`.

Mappy requests aggregate counts for up to 12 supported attribute fields and reports populated values, nulls and completeness, with the most nulls first. The calculation uses service statistics over the matching records, not a sample page. An object-ID field and statistics support are required. Authored filters and optional map extent remain in effect; empty datasets show N/A and invalid or partial statistics are rejected.

This is a null-completeness check, not a general accuracy audit. Empty strings, placeholders and incorrect values are not detected. Without an additional condition, the report offers actions to inspect nulls in the top missing fields. With a condition, Browse checked records keeps that condition. Null counts across fields must not be added together as a distinct record count.

Explore data also offers Check missing values when the layer metadata indicates it is supported.

## Added in 1.4.2: conversational table sorting

After opening a table or filtering records, ask `sort by acres descending`, `sort by Owner name A to Z`, or `sort by acres highest first`, using an actual field name or alias. Omitting direction means ascending. `Reverse the order` reverses an existing explicit table sort.

Sorting restarts at the first page and retains the filter and any current-view scope. `Show more`, `show the next rows`, and `back a page` are paging shortcuts. Paging retains the selected field and direction, with object ID as a tie-breaker where available. Existing service pagination limits still apply; current-view tables remain capped.

You can also ask `show table parcels sorted by acres desc where status equals Active`. Sorting follow-ups apply to record queries, not aggregate summaries or ranked subsets. Unknown fields and services without sorted-query support produce an explanation instead of a guessed result.

## Added in 1.4.1: conversational layer clarification

If multiple layers match a request, Mappy numbers the choices. Reply `the second one`, `choose number 2`, or an exact path such as `Utilities > Parcels` to continue the original request. Say `cancel` to stop. No layer is changed before a choice is made.

The selection binds the layer directly, so a field or search value that happens to share its name stays unchanged. The continued action supports undo. A clarification resumes only the stopped step, not later steps from a command chain. Removed layers, map changes and unrelated new requests invalidate old choice buttons. The first eight matches are listed in layer-list order.

## Added in 1.4: guided data exploration

Say `explore data` to choose an available layer or table, or ask `explore parcels`, `what can I ask about parcels?`, or `give me ideas for parcels` using an actual layer name.

Mappy builds clickable questions from the layer's metadata: totals, a table, current-view counts, numeric summaries, highest values, category breakdowns, and a sample coded-value filter. It does not invent meanings, units, findings or field names. It omits unsuitable suggestions for standalone tables and services without statistics or sorting. Opening the question list reads metadata only; selecting a question runs the corresponding query. Hidden-layer and disabled-query rules still apply.

Explore data is also a starter suggestion and appears in the command guide. With more than 20 available layers, the picker shows the first 20 and explains how to name another directly.

## Added in 1.3.3: everyday query language

- `show me parcels with acres over 5`
- `count parcels where acres is more than 5`
- `show parcels with acres between 5 and 10`
- `show me the 5 largest parcels by acres`
- `show parcels with assessed value at least 250,000`

Use actual field names or aliases. Numeric ranges are inclusive and require the lower number first. Thousands separators must be valid; raw SQL is never accepted. Quote layer names containing the words `with` or `where`.

After a filtered query, `how many of those?` counts the same matches and `show them in a table` preserves the condition and current-view scope. Follow-up suggestions appear automatically. Counting a ranked subset reports the number of displayed ranked rows rather than claiming a whole-layer total. Failed new searches and Clear results discard stale verbal result selections.

## Added in 1.3.2: conversational address corrections

After `find address 123 Main St`, say `in Grand Junction` or `actually, in Fruita` to refine the location. A later city refinement replaces the previous refinement. To change a full address (including an existing city), say `no, 125 Main Street, Fruita`. You can refine an unsuccessful lookup without retyping the street.

Choose candidates with `the second one`, `use number 2`, `pick the 2nd match`, or simply `2`. A bare street address is not treated as a result number. Saying thanks preserves the choices; a new topic, new chat, or map change clears them. Refinements retain the configured locator's restrictions and authentication.

## Added in 1.3.1: natural-language address searches

Ask `take me to 250 North 5th Street, Grand Junction`, `find the address of City Hall`, `where is 123 Main St`, or paste a street address. Mappy uses locators already configured in Search Custom, app utilities, or the signed-in portal, in that order. No new AI service, API key, or hard-coded world locator is added. Address text goes to the selected ArcGIS locator using the existing SDK authentication flow.

Configured prefixes, suffixes, country/category restrictions and within-view limits are retained. The locator's single-line input field is read from its metadata when unspecified. Up to five candidates are shown; say `show the second result` or choose a row. A single result scoring at least 95 is shown automatically. A locator score is match quality, not a guarantee that an address is correct. Search responses and old candidate buttons are invalidated when the active map changes; new searches replace old choices.

`find 123 Main St in parcels` stays a feature-layer search. Unscoped place searches can try the configured locator when no enabled-layer result is found. Add a city/state/postal code when results are ambiguous. Missing locators, unavailable services and disabled data queries produce explanatory messages. Initial lookup tries at most three configured locators sequentially, stopping at the first with candidates.

Repeated polite introductions are accepted. Follow-up counts retain their view scope, and contextual layer substitutions leave filter values intact.

## Added in 1.3

- **Simpler setup:** the builder runs an initial knowledge refresh automatically, selects the map when exactly one exists, and provides one Refresh app knowledge button afterward. Advanced scan options, custom answers, and appearance controls are collapsed. Stop preserves the saved knowledge. Refresh again after changing the app; setup does not run a continuous crawl.
- **Desktop floating:** choose Float on desktop from Mappy's options menu. In supported browsers, Document Picture-in-Picture holds the live chat and character in an always-on-top window. Move it using the browser's window title bar. Return to app or close that window to bring Mappy back. Keep the original app tab open. This is a browser-owned window, not a transparent native desktop mascot; unsupported browsers and embedded builder contexts can reject it. Chat history and map access remain in the original app session.
- **Character performances:** four occasional idle routines (peek around, stretch, refold, and consult a compass), animated speaking, and existing reaction moods. Idle performances stop while the chat is open, while working, or when animation is paused. Reduced-motion styles suppress movement. Pointer tracking follows the window containing the character.
- **Ranked and filtered queries:** `top 5 parcels by acres`, `bottom 5 parcels by acres`, `summarize acres in parcels where status equals Active`, and `show table parcels where status equals Active`. Ranked results respect the app result cap. Filtered table paging keeps the condition. Field aliases are resolved against layer metadata.
- **Layer troubleshooting:** `why can't I see parcels?` checks visibility, hidden parent groups, scale range, zero opacity, load errors, and authored filters, and offers relevant recovery actions.

- **Learn installed widgets:** included in automatic setup and the single refresh action. Imports a bundled pack of installed-widget README sections, Markdown guides and in-widget help. No folder picker, browser filesystem permission, or local helper server is needed. The pack is generated during the normal Experience Builder build and loaded when setup or refresh runs; changes to help files are build dependencies. "Only widgets this app uses" filters imports and binds actions to their actual app IDs. The separate saved-help-files import remains an advanced option with a folder picker.
- **Layer selection:** clicking a Mappy layer row selects, expands, reveals and enables the layer instead of toggling an already-visible layer off. Map Layers Custom 1.50.2 clears temporary search/favorites/visible-only filters for the reveal, opens collapsed lists and groups, and selects the SDK list item. Explicit Hide actions still turn layers off. This selects a layer row, not every feature in that layer.
- **Tables:** `list tables`, `show table parcels`, `show rows in inspections`, `next page` and `previous page`. A feature layer can also be browsed as a table. Up to eight metadata fields are shown, coded values display their labels, and numeric/date cells are formatted. Paging requires a stable object-ID sort and service pagination support. The display cap is the configured maximum results. Current-view table queries show one capped page.
- **CSV:** each table can save its displayed rows, with quoted cells and formula-like text neutralized. This exports only the displayed page, not the entire dataset.
- **Conversational follow-ups:** `say that again` repeats the last answer without rerunning a command; `show the first result` opens a result from the last search. Follow a count or field question with `what about` and another layer name. Starter suggestions use actual available layer/table names.

All language handling remains local and deterministic. Unsupported requests still need an app tool or a more specific command; there is no hidden AI backend.

Version 1.2 adds a deterministic command planner and metadata-backed analysis. No AI model, keys, paid inference, extra widget dependencies, or model server are needed. Existing ArcGIS services remain responsible for map data and queries.

## Try these commands

Use the actual layer names and field names/aliases in your map.

| Request | Behavior |
| --- | --- |
| What can you do? | Interactive command guide |
| Diagnostics | Connected map and indexed knowledge sources |
| Turn on parcels then set it opacity to 35% | Two steps sharing layer context |
| Zoom to it | Uses the last resolved layer |
| How many in view? | Counts the last layer in the map extent |
| Undo | Restores the last Mappy visibility/opacity transaction |
| Summarize acres in parcels | Count, total, minimum, maximum, average |
| Count parcels by zoning | Counts by category, with coded-value labels |
| Count parcels by zoning in view | Category counts restricted to the current extent |
| Select parcels where acres > 5 | Matching feature list; no persistent filter change |
| Count parcels where zoning equals R-1 | Count all matching features |
| Filter parcels where owner contains Smith | Case-insensitive text search |
| Count parcels where owner is null | Count missing values |
| Zoom to 39.0639, -108.5506 | Latitude, longitude navigation |
| Scale 1:5000 | Explicit map scale |

## Conversation and recovery

Layer context survives updates to the knowledge index. It clears when the connected map changes, New chat is clicked, or `forget context` is requested. Context only substitutes command targets, never search/filter values.

Join up to five commands with `then`, `and then`, or semicolons outside quoted text. Plain `and` remains part of names such as Parks and Recreation. Unsupported steps or requests for clarification stop the remaining sequence. Completed layer changes remain undoable.

Undo retains the last 20 Mappy layer visibility/opacity transactions, including affected parent groups. Multi-step requests form one transaction. Changes from other controls are preserved when their current values differ from Mappy's last values. Navigation, popups and app tool changes are not undone. Switching maps discards undo history.

## Analysis scope and limits

Analysis requires a visible, queryable layer and the appropriate ArcGIS service capabilities. Counts and statistics are computed by the layer/service rather than estimated from the displayed feature list. Queries preserve the layer's definition expression. `In view` intersects the current map extent; it is not a test of which symbols are visually unobscured.

Numeric statistics ignore null values and use the source field's units. Grouped results show up to 25 returned groups and explicitly flag service truncation; a partial response is not presented as a complete distribution. Feature lists obey the configured result cap. Queries time out, and failures explain that no result was obtained.

Conditions support a single numeric/text comparison, coded-value labels, contains, starts with, and null checks. Exact field names take priority over aliases. Ambiguous aliases require an exact name. Fields come only from metadata, numeric values are validated, and text is quoted. Arbitrary SQL is never executed. Wildcards in contains/starts-with requests are rejected. Use native app tools for dates, compound conditions, spatial joins, buffers and unsupported analysis.

English phrasing is supported by explicit patterns, retrieval, synonyms and fuzzy matching. Mappy does not invent answers or provide general-purpose LLM reasoning.

## Chat and privacy

Explore opens the guide. New chat clears the transcript and layer context. Save chat downloads a text transcript including analysis tables and source details. Chat content is held in page memory. Source disclosures distinguish live app/map knowledge, saved scans, imported help, app-author answers and built-in guides.

Telemetry is disabled unless `telemetry: true` is explicitly set. The existing Beacon destination and data fields are documented in the README. Reload after changing telemetry settings. Map data, service queries, manifests and optional help scans may use the network; the assistant itself does not call an AI provider.

## Validation and installation

Run `node tests/local-assistant.cjs` from the installed widget folder. It uses the host's TypeScript dependency. An explicit TypeScript package path may be supplied as the first argument when testing a staged copy. No test libraries need to be installed.

The settings Try it panel remains a knowledge-search preview; run the app with an active map to test map commands. After replacing the widget source, let the running Experience Builder watcher rebuild, or run the existing client build/start command. Refresh the experience. Existing map selection, FAQ, scans and appearance settings remain compatible.
