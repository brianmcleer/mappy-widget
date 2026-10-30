## 1.9.0 (2026-10-29)

- Guided tour: "show me around", "give me a tour", "walk me through this app". He visits the app's tools one at a time, says what each does and where it lives, points at it and pulses it when it is on screen, with Next and Stop tour chips ("finish tour" on the last stop).
- "What did I change": everything he has done to the map's layers this session, oldest first, with Undo and Reset the map offered. "Try again" (also "retry", "once more", "again") runs the last real request once more; a server hiccup reply now carries a Try again chip, and control words ("undo", "next", "yes") never become the thing to run again.
- "What did I click" (also "what's this", "tell me about this feature", "details") reads the feature under the open popup as a table of its fields, with the layer's counts, fields and explore offered next. ID and shape fields are left out.
- A light bulb when a popup opens (at most once every three minutes): what he can tell you about that layer's features.
- Suggestions as you type: after two letters, up to five continuations under the box, from his starters ("turn on", "where are the", "what did I change") and from the app's own names ("turn on Par" offers "turn on Parcels", "open Le" offers "open Legend"). Tab takes the first, Escape hides them, clicking one fills the box.
- Settings: a Preview section shows him in any of the 80 outfits and 30 acts now, without waiting for the day; Play again replays the act. Picks change nothing in the app.
- Knowledge feed: once a day each browser fetches one JSON file (cached, never waited for, ETag-aware) with a newer language pack, questions and answers, glossary terms, fun facts and tips, so he keeps improving without an app update. The project's feed (`knowledge/feed.json`) is rebuilt by the weekly language build and whenever `knowledge/knowledge.json` changes. Settings: turn it off, point at your own copy (an internal web folder), Check now. Only https, only JSON under 2 MB, only the feed format; the bundled knowledge stays when a feed fails. Your own answers outrank the feed's; built-in terms keep their meanings. Diagnostics says what the feed gave him.
- "What's on the map" (also "what am I looking at", "describe the map"): which layers are drawing, the basemap, the scale and center, whether a popup is open, and how many changes he has made.
- "Copy that" copies his last answer; "export chat" (save the conversation) downloads it as a text file. "What did I click" now offers Zoom to it.
- Data questions with time in them: "parcels edited in the last 7 days", "how many hydrants were inspected this year", "manholes installed before 1990", "permits issued since March 2024", "sales on 6/1/2025", "between 2020 and 2022", "last month", "yesterday". The verb picks the date field (edited, created, installed, inspected, built, replaced, sold, issued, closed...), or the layer's only date field; layers that store years (YEAR_BUILT) work too. Date fields also take comparisons ("install date > 2015") and "where" conditions ("where sale date is in the last 30 days").
- Up to three conditions with "and" ("acres > 5 and zoning is R-4"), lists with "or" ("zoning is R-4 or R-8", "status is not Active or Retired"), each still compiled from known fields only.
- "What percent of parcels are over 5 acres", "what share of hydrants were inspected this year": the part, the whole and the percent, with Show them.
- Statistics per group: "average acres by zoning in parcels", "total length of sewer mains by material", "how many parcels per zoning", answer first (highest and lowest), then the table.
- MCP server 1.6.0: `describe_layer` (schema with field types, allowed values, count, last edit) and `query_layer` (field filters with a fixed set of operators, dates, lists, rows with sort, counts, sum/avg/min/max per group), so desktop assistants can ask the GIS real data questions without SQL. Mappy keeps choosing the simpler tools for plain place questions.
- First visit: the greeting offers the tour ("New here? Say show me around") with Show me around, What is on the map and Help chips.
- Help lists "Take the tour" and "Look back"; the "new since last time" line mentions the tour, history and suggestions.

## 1.8.0 (2026-10-29)

- Ask what things mean: a built-in glossary of 70 map and city words in plain language ("what is an easement", "what does floodplain mean", "define right of way"), with the matching layer or tool offered when the app has one. Codes come from the map itself: "what does R-4 mean" reads the layer's own code list (or the deep scan), and falls back to a plain reading of zoning-style and FEMA codes with a note to check the legend.
- "What zoning types are there", "what values can status have": a field's code list from the live layers, with "How many of each?".
- Questions a map cannot answer get a kind pointer instead of "I found nothing": office hours, meetings, the weather, bills, taxes and appraisals, what is allowed on a property, events, bus schedules, emergencies, where to find the zoning code, and things to report (potholes, leaks, streetlights), with the app's Report a Concern tool or link offered when it has one. The app author's own answers still win.
- Natural data questions: "which zoning has the most parcels" (answer first, then the table), "largest parcel", "the 3 smallest parks", "parcels bigger than 5 acres", "hydrants older than 1990", "how many parcels over 2 acres", "parcels where owner is Smith". An exact text match that finds nothing offers "contains".
- Layers by name: "where are the parks" and "show me all the hydrants" turn the layer on and zoom to it; "what parks are there" and "list the schools" list the first names; "the parcels layer is not showing" and "why did it disappear when I zoomed out" diagnose; "nothing is on the map" explains what is on, what needs zooming in and what to do.
- Labels: "label the parcels", "turn on labels", "turn off labels for hydrants".
- Map words: "what do the colors mean" opens the legend; "print this map", "share this map", "measure distance", "add a note to the map" and "change the basemap" open the matching tools; "satellite view", "switch to topo" and "what basemaps are there" change the background from the portal's basemap list (with "put it back"); "what is the scale" says what an inch covers; "go back" returns to where the map was (30 steps); "reset the map"; "center the map on <address>".
- Places: "directions to City Hall from 1718 White Ave" (the server's route tool when it has one, else both pinned, the straight-line distance and a turn-by-turn link), "what are the coordinates of <address>", "what address is at <lat, lon>" and "what street is this" (reverse geocoding), "what is near <address>", "the flood zone for <address>" and other thing-for-place phrasings, "who owns <parcel number>", and "compare A and B" / "which is bigger, A or B" / "is A older than B" (side by side, answer first).
- About the data: "when was parcels updated", "who maintains hydrants", "is this map accurate", "disclaimer": the layer's last edit date and source, with a general-reference note.
- Small talk and control: "ok", "cancel", "never mind", "repeat that", "read that aloud", "make yourself smaller", "move to the left", "stop animating", "animate again". Leading "ok,", "so", "and" are ignored ("ok zoom out").
- Addresses in Mappy's answers are buttons that go there.
- The conversation survives a page reload (this tab), with a "Welcome back" line; New chat clears it. Returning people get a one-line "new since last time" with each update.
- Fixed: "sanitary pipe near 1138 White Ave" asked "Closest to where?" (the city server's reverse geocoder, "the address nearest a point", was outranking the Closest feature tool); a thing to look for now always goes to a tool with a layer input. Answering "Closest to where?" with an address swaps it into the question instead of gluing it on.
- An outfit for 80 days of the year, head to toe: a hat on his top fold (with a shadow, not floating), something in his hand that waves with it, a patch on the paper, things at his feet, a buddy beside him (penguin, squirrel, groundhog, fox, dog, cat, polar bear, parrot) and pieces drifting at his sides. The calendar is the light-hearted "day of" kind: Pizza Day, Puzzle Day, Groundhog Day, Leap Day, Pi Day, Pencil Day, Earth Day, Superhero Day, Dance Day, Space Day, Bee Day, Donut Day, Oceans Day, Moon Day, Cat Day, Talk Like a Pirate Day, Coffee Day, Taco Day, Sandwich Day, Recycling Day, Cookie Day, GIS Day, the seasons and more. Nothing religious, no flags, no brands, no cultural costumes. "What are you wearing" and "what's today" explain the outfit; the big days open with a mood (party on New Year, a dance on Dance Day).
- Nothing in him is tied to one town. A new "Your place" section in settings holds the organization ("the City", "the County", "the Water District"; empty uses the portal's organization name), the place name, the website (offered as a link when he points people off the map) and a library of local fun facts, one per line. "Build facts from Wikipedia" reads the place's page and a few pages for parks, landmarks and rivers nearby (CC BY-SA, each line names its page) into that list for the builder to prune and save; only the builder's browser calls Wikipedia. The built-in facts, jokes and art no longer mention any particular city, and a test keeps it that way.
- Ask about his outfit by name or by its pieces ("why the pi symbol", "what's with the pumpkin", "is that a taco", "nice hat") and he says what day it is and why he dressed for it.
- The Clippy pack. The Office Assistant had about forty little performances; Mappy now has his own, redrawn for a paper map, in `Acts.tsx`. Between tasks: finger tap, head scratch, eyebrow raise, side to side, an atom with orbiting electrons, folding flat into a stack of paper, folding into a paper airplane and looping, reading glasses with a sheet, headphones, a bike ride across the screen, and three transformations (beret and palette, antenna and pixel eyes with binary rain, wizard hat with a wand). At work: gears while a server call takes a while, a pencil writing lines when records go to the Table, reading glasses and a checklist for "what's at", a bouncing "!" on an error, a chalkboard and pointer for meanings and help, knocking on the glass for a tip, a printer for Print, an envelope for Share, diving into a recycling bin for "reset the map", a trophy for congratulations, and riding off on the bike. Ask for the fun ones: "get artsy", "get techy", "get wizardy", "paper airplane", "ride your bike", "do a trick".
- "Good job" earns a trophy raise; "bye" is a bike ride off (then the chat closes); "what tricks can you do" lists them all; "fact", "facts", "trivia" and "local fact" work alongside "fun fact". One or two unknown words get "I'm not sure what you mean by X" with a way to ask, instead of a list of loosely matching help topics.
- "My address" is kept in memory for the page only, never in browser storage; say it again next visit, or "forget my address" to clear it early.
- Sound effects (settings, off by default): a pop when he arrives, a knock for a tip, a ta-da for good news, a wobble for an alert, a boing when you boop him, a tick while gears turn, a whoosh when he folds away. Synthesized on the spot, no files, silent under reduced motion or Pause.
- Build facts from Wikipedia finds the page by city plus state, province or country ("Grand Junction" + "Colorado", "Lyon" + "France"), falls back to Wikipedia search when the exact title differs, and reports what it is doing as it goes.
- More feeling: he shivers in winter outfits, fans himself in summer ones and sneezes in spring ones; hums, yawns and looks around between tasks; buddies bob and hop when you hover. The greeting knows the clock ("Monday morning, we've got this", "Friday afternoon, almost there", lunchtime tacos, working late); "how are you" gets a real answer.
- Settings: "Jokes, games and holiday hats" can be turned off for a formal app.

## 1.7.1 (2026-10-28)

- "Turn on only towers and everything else off" (and "turn everything off except towers", "hide all but towers", "towers only", "turn on towers and the rest off") shows just that layer, with Undo. The typo reader no longer turns "else" into "ele".
- Time of year, friendly for everyone (nothing religious, political, or cultural costume): New Year party hat, winter beanie, Valentine's hearts, Pi Day badge, April Fools, spring flowers, Earth Day leaves, Independence Day fireworks, summer sunglasses, fall scarf, spooky-season pumpkin, GIS Day globe (third Wednesday of November, all week), Thanksgiving fall leaves, winter-holiday snowflake beanie. Each with a greeting line and a few seasonal jokes; "what's today" says what's on. A test reads every greeting and joke for a whole year.
- Audit fixes: a riddle no longer swallows the next command; easter eggs only answer their exact phrases; "near me" asks for your location only on place questions and says when it could not get it; "table of contents" and "show the results in a table" are no longer read as layer names; "only show me parcels" works, while "just show me how to print" is not a layer command; "show only X" saves one undo step, not two; the Table's View in table is waited for on first open, a service's record limit is reported, and tab switching is released afterwards; closing the chat while the microphone is on no longer sends; copy works in the pop-out window and says when it fails; the chat stays where you scrolled while Mappy types; the resize grip is larger, darker and clear of the close button; reduced motion now covers everything in the chat; the Konami code ignores typing in text boxes and the builder.
- Ask by voice: a microphone button next to Ask (Chrome, Edge, Safari); words appear as you speak and send when you stop.
- Copy any answer (with its table as rows you can paste into Excel) from the button on its corner.
- "Closest hydrant to me", "parks near me", "what zone am I in" use where you are (the device's location, when allowed) instead of the middle of the map.
- Ready for Esri's MCP servers: newer protocol versions (2025-11-25), clearer sign-in messages that say which setting to change, Web Mercator points, resource links and embedded resources in answers, camelCase address inputs (singleLineAddress). gis-mcp 1.5.0 can pass Esri's MCP tools through (see its README).
- Easter eggs, all PG: 25 original map jokes (no repeats until they run out), knock-knock jokes both ways ("knock knock" / "tell me a knock knock joke"), riddles, fun map facts (Grand Junction and Colorado ones too), "do a dance", "do a barrel roll", "sing a song", "party mode", magic compass, coin flips, dice ("roll a d20"), rock paper scissors, Null Island, "I'm bored", "boop", "boo" and more. Click Mappy six times fast and he gets dizzy; type the Konami code anywhere for party mode. Seasonal hats: a witch hat in late October and a Santa hat in December. "Have some fun" is in the help list.
- Drag the chat's title bar to move Mappy and the chat together. The "Local" badge is gone.
- The Table, everywhere it helps: "Open in Table" on closest/within answers (the same features, by distance), on search results (by id), on filter and count answers, and on a layer's description. The whole layer switches to the Table's own tab for it when the app has one. Sidebars open on the side that actually collapses (collapseSide), through sidebars inside sidebars.
- Help guides open reliably: Mappy waits for the widget to load (up to 4 s), looks in the widget and the panel around it, and leaves a guide that is already open alone.
- Friendlier wording: no object ids or global ids in chat tables, "columns" instead of "fields", and "Which one do you mean? Try one of these: ..." with readable names when a field is unclear.
- Opens the app's Table widget: "show table hydrants", "open hydrants in the table", "the parcels table", "attribute table for hydrants where status is active" open the Table (expanding the Sidebar or Sidebar Custom panel, or the controller, that holds it) with those records in a new tab, through the Table's own View in table action. Filter and count answers get an "Open in Table" button; "Show rows here instead" keeps them in the chat.
- Resizable chat: drag the grip on the bubble's free corner (or focus it and use the arrow keys; Shift for bigger steps). Double-click or Home goes back to the automatic size. The size is remembered per app.
- Mappy, your new BFF: he leans toward the pointer, blushes and waves when you hover, squishes and pops a heart when you boop him, swings when you carry him, and gets two new moods: love (happy eyes, floating hearts, blushing) for "thanks", "you're the best", "good job", "high five"; excited (happy dance, confetti) when you come back after a while. New idle skits: dance, wink, paper heart. Pupils grow when he's happy. All motion still stops under reduced motion or "Pause animation".
- Answers worded for what was found: "Trash pickup at 250 N 5th St is on **Tuesday**", "1138 White Ave is zoned **RM-8**", "... is in Council District **3**"; field and layer names moved to Sources.
- Suggestion chips name exactly what they mean ("What is the zoning at ...", "Is ... in a flood zone?", never a vague "zone") and only offer layers the map or the server has. "Which council district is X in" and "which schools serve X" now read as place questions.
- "How far is 1718 White Ave from City Hall": straight-line distance, both places pinned and joined on the map.
- "What properties does Jane Doe own" / "parcels owned by ...": the server's parcel search by owner.
- "Who owns this" with a parcel popup open answers from that feature directly. Slow lookups say "Still checking...".
- Starter chips and help lead with a place question when a GIS server or a parcel layer is available.
- gis-mcp 1.4.1: layer-name matching cached and warmed (one question took 24 s with 827 layers; now well under a second); stale layer lists re-read once in the background instead of by every request; a sign-in-only copy of a public layer falls back to the next match.
- Everyday property questions: "when is trash pickup at ...", "which school does ... go to" (elementary, middle and high), "who is the council rep for ..." (the name), "what water district serves ...", "how many acres is ..." (with square feet), "when was ... built" (with age), "what's the parcel number for ...". "My" works too: "when is my trash day", "who is my council rep".
- Two questions in one: "who owns 1718 White Ave and what zone is it".
- "Tell me about 1718 White Ave" gives a short property summary, one line per layer (owner, zoning, pickup day...), with every record under Details.
- Owner answers name joint owners too. Follow-up chips offer what was not just asked.
- "Who owns it" right after the Search widget uses the Search result marker (newest one on screen), not only an open popup.
- Follow-ups keep the place's name: chips and answers say "250 N 5th St", not coordinates or "that spot".
- Field names shown readable everywhere: the alias when it is a real label, else the name made readable (PARCEL_NUM is "Parcel Number", JTOWNER "Joint Owner", AYB1ST "Actual Year Built 1st", SUBDIVISIO "Subdivision").
- Place answers lead with the one value asked about ("**DOE JANE** owns 250 N 5th St"); the full record is in a Details fold, not a table.
- The pop-out window is the chat: full window, small Mappy in the header, return-to-app button; the input no longer reads "Placeholder".
- gis-mcp 1.3.2: "within" searches every layer that fits equally ("manholes" under storm and sanitary); "zone" means Zoning; a layer that needs a sign-in reports it instead of answering "no"; readable field names in results.
- Keep a place question's origin, layer and radius across follow-ups: “what about hydrants?”, “within 1,000 feet?”, “actually at 250 N 5th St”, and “and parks”. An origin chosen as “here” stays fixed even when displaying results moves the map.
- Ask which place “it” means when no place is selected or remembered. Preserve literal addresses during place-question reading.
- Restore multi-turn collection of missing MCP inputs, including GIS tools whose schema allows an address or coordinates. Read-only tasks run once their inputs are complete; changes still require confirmation.
- Expire pending MCP requests and cached tool permissions on map/server/settings changes and conversation reset. Discard late responses for a previous map or server.
- Distinguish a failed local boundary lookup from a successful lookup with no match. A failed service cannot become a negative yes/no answer.
- Verify the TypeScript client against the Python companion server with simulated ArcGIS data, including an unsuccessful address and recovery.

## 1.7.0 (2026-10-27)

- Addresses show their parcel: after Mappy finds an address, the parcel under it is highlighted with its popup open, a pin on the address, and the owner, parcel number and acres in the answer. Uses the app's own parcel layer; no server needed.
- "Who owns 250 N 5th St", "who owns it" (after the Search widget or Mappy found it), "what zone is this in": answered from the app's own layers when the map has one, highlighted on the map; the server answers otherwise.
- Yes or no questions get a yes or no: "is 1138 White Ave in city limits", "is it in a flood zone".
- Place answers turn on their layer (and every group above it), pin the place, ring what was found, draw a line to the closest one and zoom to fit; "undo" turns the layer back off.
- Ask about places in plain words, no "ask the server" needed: "what is the closest sewer line to my address", "hydrants within 500 ft of here", "who owns 123 Main St", "what zone is 250 N 5th St in", "what's at 250 N 5th St", "count sewer mains by material". Mappy picks the server tool, fills it in and answers in a sentence ("The closest sanitary sewer main to 250 N 5th St is SM-101, about 75 ft away"), with a table, a Zoom there button and follow-up suggestions.
- "My address": say "my address is ..." once (or answer when he asks) and he uses it for "my address", "my house" and "where I live". It is kept in this browser only. "forget my address" clears it.
- When a place question has no place ("nearest hydrant"), he asks "Closest to where?" with buttons for your address and the middle of the map, instead of guessing.
- When Mappy is stuck on a plain question that a read-only server tool can answer as asked, he answers it instead of only offering a button.
- Server answers that list layers show as a list; latitude and longitude columns are left out of tables. The "I read that as" note no longer appears for apostrophes alone.
- gis-mcp 1.1.0: new `nearest_feature`, `features_near` (buffer) and `summarize_layer` (group-by counts) tools; `identify` takes an address; layers can be named in plain words with synonyms and typos ("sewer lien" finds Sanitary Sewer Mains).

## 1.6.1 (2026-10-27)

- Data tasks: the last data query shows as a "Data task" card (layer, scope, filter, order, last successful run) with Refresh, whole layer or current view, Remove my filter, and Count matches or Show matching rows. Saying "use whole layer", "use current view" or "remove my filter" does the same. A failed run keeps the last good task; old buttons, another map or a removed layer are refused.
- Layer commands without a layer ("turn on a layer", "select a layer", "show table") ask which layer. Answer with a button, a number, "the first one", a name, or part of a name ("choose storm" narrows the list).
- "hide it", "turn it back on", "show its table" and "list its fields" follow the last layer, including one picked with a button before any chat.
- Table and count follow-ups keep the filter, sort and map view; ranked or summarized results are not expanded.

- MCP: picks the right tool from how a request is worded. A layer named in the request, "here", "how many", "find" and "maps about" each point at a tool. Among close matches he prefers one whose inputs can be filled. Point tools no longer quietly use the map center unless the request says "here". Server answers lead with the server's own sentence. Count, find and "maps about" words are no longer sent as search text.
- New companion: `mcp-server/gis_mcp.py` in the repository, a free, read-only, in-house MCP server for ArcGIS Enterprise. It sends each user's own token, so there's no service account.
- Fixed: Get language updates, `language/sync.mjs` and the Test workflow pointed at a `main` branch; they now use the repository's default branch.

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


