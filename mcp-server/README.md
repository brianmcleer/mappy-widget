# gis-mcp: an in-house MCP server for ArcGIS

A small, read-only MCP (Model Context Protocol) server for your own ArcGIS Enterprise services. Mappy uses it as its MCP server. Any MCP client can use it too: Claude, VS Code Copilot, Cursor.

It costs nothing beyond a Python process on a web server you already run. It uses your own locator, layers and Portal, so there are no Esri credits.

## Tools

| Tool | What it does |
| --- | --- |
| `geocode` | Find an address with your locator |
| `reverse_geocode` | The address nearest a point |
| `nearest_feature` | The closest feature of a layer to an address or point, with distances in feet ("closest sewer line to 250 N 5th St") |
| `features_near` | Features within a distance of an address or point ("hydrants within 500 ft") |
| `identify` | What is at an address or point (parcel and owner, zoning, flood zone...) across the searchable layers |
| `summarize_layer` | Counts grouped by a field ("sewer mains by material") |
| `find_features` | Search a layer by name, address, owner, number or id |
| `count_features` | Count a layer's features, optionally only those matching some words |
| `describe_layer` | A layer's schema for assistants: every field with its type (text, number, date) and allowed values, record count, geometry, last edit |
| `query_layer` | Structured data questions for assistants, with no SQL: field filters (=, !=, >, <, contains, starts_with, in, between, is_null, in_last_days...), then rows (fields, sort), a count, or sum/avg/min/max, optionally per group |
| `list_layers` | The layers it can search |
| `search_content` | Find maps, apps, layers and documents in Portal |
| `ask_assistant` | Off unless turned on. Claude answers a plain-language question with the tools above, on this server, with your organization's Anthropic key (see [Claude on the server](#claude-on-the-server-optional)) |

Layers can be named in plain words: "sewer line", "sewer lien" (typo) and "sewer pipes" all find Sanitary Sewer Mains. Words like line, main and pipe prefer line layers; hydrant, manhole and valve prefer point layers.

In Mappy, just ask: "what is the closest sewer line to my address", "hydrants within 500 ft of here", "who owns 123 Main St", "what zone is 250 N 5th St in", "count sewer mains by material". Also: "ask the server where is 250 N 5th St", "ask the server what's here", "ask the server find O'Brien in parcels", "ask the server how many parcels", "ask the server find maps about zoning".

## Security

- **No service account.** Mappy sends the signed-in user's own ArcGIS token. The server passes it to the services, so people only see what Portal already lets them see. A request without a token only reaches public data, or is refused if `require_token` is on.
- **Read-only by construction.** It only calls `query`, `findAddressCandidates`, `reverseGeocode` and Portal `search`. It only calls the locator, Portal, folders and layers named in `config.json`, and no other URL can be reached.
- **Only your apps.** Browser requests are accepted only from the addresses in `allowed_origins`, which also blocks other web pages (DNS rebinding). Desktop clients send no Origin and are allowed.
- Searches are built from escaped words, never from SQL that someone typed. `query_layer` takes filters as field, operator and value: fields must exist on the layer, operators come from a fixed list, numbers must parse as numbers, dates as dates, and text is quoted and escaped.
- Logs record the tool name, how long it took and the input names. They never record tokens or values. Logs are kept 30 days.
- Layer names are read once an hour, using whoever asks first (or `discovery_token`). Only the names are shared between people; every query runs with the asker's own token.

## Install (Windows Server with IIS)

1. Copy this folder to the server.
2. In PowerShell (**Run as administrator**), from that folder:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   It creates the target folder (default `D:\GIS\Services\gis-mcp`; pass `-Target` for another), a `.venv` from ArcGIS Pro's Python with Flask and Waitress, the IIS app pool `gis-mcp` (No Managed Code, AlwaysRunning), and the application `/gis-mcp` under Default Web Site. It also sets folder permissions and checks `/health`.
3. Edit `D:\GIS\Services\gis-mcp\config.json`:
   - `service_folders`: REST folders whose layers should be searchable, for example `https://gis.example.org/arcgis/rest/services/Hub`. Every feature layer in them is added.
   - `layers`: single layers to add, with optional `search_fields` (the fields `find_features` looks in) and `fields` (what to show).
   - `allowed_origins`: the addresses your Experience Builder apps load from.
   - `locator_url` and `portal_url`.
4. Check what it finds. In PowerShell (regular), in `D:\GIS\Services\gis-mcp`:
   ```
   .venv\Scripts\python.exe gis_mcp.py --config config.json --check
   ```
5. Recycle the pool. In PowerShell (**Run as administrator**):
   ```
   Restart-WebAppPool gis-mcp
   ```
6. Open `https://gis.example.org/gis-mcp/health` in a browser. It shows the version and how many layers it found.

### Connect Mappy

In Mappy's settings, open **MCP server**:

- **Server address**: `https://gis.example.org/gis-mcp/mcp`
- **Name in the chat**: `City GIS`
- **Sign in with**: **The signed-in ArcGIS user**

Press **Connect and list tools**. Every tool is read-only, so all of them start on. Save the app.

### Claude on the server (optional)

`ask_assistant` lets Mappy hand a question it cannot answer to Claude and show the answer in its own chat. Claude runs here, uses only this server's read-only tools, and the Anthropic API key never leaves the server. People need no Claude account.

1. Get an API key from the Anthropic Console (console.anthropic.com) under your organization's account. Each answer is billed per use.
2. On the server, add the key as an environment variable for the app pool. In web.config, inside `<environmentVariables>`:
   `<environmentVariable name="ANTHROPIC_API_KEY" value="sk-ant-..." />`
3. In `config.json` add:
   ```json
   "assistant": { "enabled": true, "org_name": "the City" }
   ```
4. Recycle the app pool. `/health` shows `"assistant": {"status": "ready"}`, or what is missing.
5. Test it from the server, in Command Prompt (regular), in the gis-mcp folder, with the key set in that window (`set ANTHROPIC_API_KEY=sk-ant-...`): `.venv\Scripts\python.exe gis_mcp.py --config config.json --ask "how many fire hydrants are there"`. It prints the answer, the tools used and the tokens spent.
6. In Mappy's settings, **Where he gets help**: **Claude, answering in the chat (through my GIS server)**, then **Check that the server has Claude**.

Answers can carry buttons for the map (Claude calls `map_show_place`, `map_show_layer` or `map_suggest_command`; nothing changes until the person clicks), a small chart (`show_chart`) or table (`show_table`), and up to three follow-up questions. Claude answers in the language of the question. To keep the cost down, the instructions and tool list are marked cacheable (repeat questions pay a fraction of the input), the same question from the same person within `cache_minutes` is answered from memory, and a busy moment is tried once more before giving up. `/health` shows today's questions and tokens under `assistant.today`.

What the server needs on the network: outbound HTTPS (port 443) to `api.anthropic.com`. Behind a proxy, set `HTTPS_PROXY` for the app pool. If the network inspects HTTPS and the connection is "not trusted", save the organization's root certificate as a PEM file and point `assistant.ca_bundle` at it. A whole answer is kept under `total_seconds` (95) so it fits inside IIS's two-minute request limit; when time or steps run short, Claude is told to answer with what it has.

After going live, two things tell you how it is doing: `python gis_mcp.py --config config.json --usage` prints questions, tokens and estimated cost by day and month, and `logs/assistant-feedback.csv` holds the thumbs up and down people gave (the question and the answer they rated, and a short hash of who).

Before going live, review real answers: put the questions people ask in a text file, one per line (see `eval-questions.example.txt`), and run `python gis_mcp.py --config config.json --eval questions.txt`. It writes every answer, the tools used, the seconds and the tokens to a CSV next to the file.

Daily questions and tokens are saved in `logs/assistant-usage.json`, so the limits hold across restarts. `/health` shows `today` and `this_month`; set the `price_per_mtok_*` keys to your plan's prices to see an estimated cost there. With `require_token` off (a public app), people are told apart by address and get `anonymous_per_hour` questions each.

**Limits per person.** When `portal_url` is set, each question's token is checked with the Portal (`community/self`), which gives the username the person signed in with (their single sign-on identity) and their Portal groups. Questions are counted per person, so a new browser, a new device or a new sign-in does not start a new count, and a made-up or expired token is refused. Each person gets `per_person_per_hour`, `per_person_per_day` and `per_person_per_month` questions (and, if you set it, `per_person_tokens_per_month`). `groups` gives other numbers to members of a Portal group, by title or id; the most generous matching rule wins and 0 means no limit:

```json
"groups": [
  { "group": "GIS Division", "per_day": 200, "per_month": 3000 },
  { "group": "Planning", "per_day": 100 }
],
"allow_groups": []
```

`allow_groups` limits Claude to members of the listed groups. The whole server has its own ceilings on top (`per_day`, `per_month`, `max_tokens_per_day`, `max_tokens_per_month`). Every answer carries a `limits` object (left today, left this month), and Mappy tells the person once they are within `warn_at` of a limit; `assistant_usage` answers "how many do I have left". `--usage` lists people for the month. The usage file keeps a short hash of each username unless `usage_names` is true. If the Portal cannot be reached, tokens are told apart by a hash of themselves, as before. Set a monthly spend limit on the workspace in the Claude Console as well: that is the hard stop on the bill, whatever this server counts.

If Mappy's "Send a picture of the map" is on, a small JPEG of the map (under 180 KB) comes with questions about what is on screen and goes to Claude as an image; set `allow_images` to false to refuse pictures on the server.

What goes to Anthropic: the question, one line about where the map is (and a few values of the feature under an open popup), up to three earlier turns, and the results of the tools Claude calls. Tokens are never sent. Signed-in users only by default (`require_token`), with limits per person per hour and per day. Each call is logged with its duration and the tool names, never the question. The outbound call goes to `api.anthropic.com` over HTTPS (the usual proxy settings, `HTTPS_PROXY`, apply).

### Connect a desktop AI tool (optional)

For people who work in the Claude desktop app: it can use these tools directly, signed in the way they already use Claude, with no API key here. In Claude Desktop: **Settings**, **Developer**, **Edit Config**, then add (on a machine on your network):

```json
{
  "mcpServers": {
    "city-gis": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://gis.example.org/gis-mcp/mcp"]
    }
  }
}
```

`python gis_mcp.py --config config.json --desktop-config` prints this with your server's address filled in. Restart Claude Desktop. Needs Node.js. For layers that need a sign-in, add `"--header", "Authorization: Bearer ${GIS_TOKEN}"` to `args` and `"env": { "GIS_TOKEN": "<ArcGIS token>" }`, or run the server locally over stdio (below).

Assistants do best with `describe_layer` first (field names, types and allowed values), then `query_layer` ("permits issued in the last 30 days", "average acres by zoning", "hydrants installed before 1990, sorted by install date").

Point it at `https://gis.example.org/gis-mcp/mcp` with an `Authorization: Bearer <ArcGIS token>` header. Or run it locally over stdio. In PowerShell (regular):

```
$env:GIS_MCP_TOKEN = "<ArcGIS token>"
python gis_mcp.py --config config.json --stdio
```

## Test without a server

Needs Python with Flask. In PowerShell (regular), in this folder:

```
python tests\test_gis_mcp.py
```

It runs against `tests\fake_arcgis.py`, a stand-in for ArcGIS REST.

## Config reference

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | City GIS | Shown to clients |
| `allowed_origins` | none | App addresses allowed to call it from a browser |
| `portal_url` | none | Enables `search_content` |
| `locator_url` | none | Enables `geocode` and `reverse_geocode` |
| `locator_single_line_field` | SingleLine | The locator's single-line field |
| `service_folders` | none | REST folders whose feature layers are searchable. Layers inside groups at any depth are included, named by their group when two share a name ("Storm - Manholes"). The services root (`.../arcgis/rest/services`) reads every folder |
| `skip_folders` | System | Folders left out when reading the services root |
| `layers` | none | Extra layers: `name`, `url`, optional `search_fields`, `fields`, `identify` (false to leave a layer out of identify) |
| `require_token` | false | Refuse requests without a signed-in user |
| `discovery_token` | none | Token for reading layer names at start (optional) |
| `max_results` | 25 | Most records per search |
| `identify_max_layers` | 25 | Most layers checked by identify |
| `nearest_max_feet` | 26400 | How far `nearest_feature` looks before giving up (5 miles) |
| `identify_point_tolerance_feet` | 25 | Search distance for point and line layers in identify |
| `refresh_minutes` | 60 | How often layer names are re-read |
| `timeout_seconds` | 20 | Per request to ArcGIS |
| `verify_tls` | true | Check HTTPS certificates |
| `log_dir`, `log_days` | logs, 30 | Daily log files and how long to keep them |
| `upstream_servers` | none | Other MCP servers whose tools pass through this one (see below) |
| `public_url` | from the request | This server's public address, for OAuth metadata |
| `oauth_authorization_servers` | none | Sign-in servers MCP clients should use; turns on `/.well-known/oauth-protected-resource` |
| `assistant.enabled` | false | Turns on `ask_assistant` (also needs the key) |
| `assistant.api_key_env` | ANTHROPIC_API_KEY | The environment variable holding the Anthropic API key |
| `assistant.model` | claude-sonnet-5-5 | The Claude model. `claude-haiku-5-5` is faster and cheaper; `claude-opus-5-5` is the most capable |
| `assistant.total_seconds` | 95 | The most time one answer may take, start to finish |
| `assistant.ca_bundle` | none | A PEM file with your organization's root certificate, for networks that inspect HTTPS |
| `assistant.label` | Claude | Its name in answers |
| `assistant.org_name` | the server name | Who runs the app, for Claude's instructions |
| `assistant.extra_instructions` | none | Added to Claude's instructions (house style, departments to point to) |
| `assistant.require_token` | true | Only signed-in people may ask |
| `assistant.identify` | true | Ask the Portal who each token belongs to, and count per person (needs `portal_url`) |
| `assistant.per_person_per_hour`, `_per_day`, `_per_month` | 30, 50, 500 | Questions each person may ask (0: no limit) |
| `assistant.per_person_tokens_per_month` | 0 (no cap) | Tokens each person may use in a month |
| `assistant.groups` | none | Other limits for members of a Portal group: `{"group", "per_hour", "per_day", "per_month", "tokens_per_month"}` |
| `assistant.allow_groups` | none (everyone signed in) | Only members of these Portal groups may ask |
| `assistant.warn_at` | 5 | Tell the person how many are left once they are this close |
| `assistant.usage_names` | false | Keep usernames (not a hash) in the usage file and `--usage` |
| `assistant.per_day`, `assistant.per_month` | 1000, 0 | Questions for the whole server (0: no limit) |
| `assistant.max_tokens_per_month` | 0 (no cap) | Tokens for the whole server in a month |
| `assistant.max_steps`, `assistant.max_tokens`, `assistant.timeout_seconds` | 6, 1200, 60 | Tool rounds per answer, answer length, wait per API call |
| `assistant.apps_only` | true | Only the map apps (requests with an allowed Origin) get `ask_assistant`. Desktop assistants connecting to this server bring their own model |
| `assistant.feedback` | true | Take thumbs up and down on answers (`assistant_feedback`), saved to `logs/assistant-feedback.csv` |
| `assistant.anonymous_per_hour` | 5 | Questions per hour for someone who is not signed in (only when `require_token` is false) |
| `assistant.allow_images` | true | Accept a picture of the map with a question |
| `assistant.usage_file` | assistant-usage.json | Where daily questions and tokens are saved, in the log folder (empty: not saved) |
| `assistant.price_per_mtok_in`, `_out`, `_cached` | 0 | Your prices per million tokens, for the cost estimate in `/health` |
| `assistant.max_tokens_per_day` | 0 (no cap) | A spending guard: no new questions once this many tokens (in and out) were used today |
| `assistant.redact_fields` | none | Field names or labels ("owner", "phone") left out of the data Claude sees, so they never reach the API. Matching ignores case, spaces and underscores |
| `assistant.log_questions` | false | Write each question to the log (with a short hash of who asked) |
| `assistant.cache_minutes` | 10 | How long the same question from the same person is answered from memory (0 turns it off) |
| `assistant.retry_wait_seconds` | 1.5 | Wait before the one retry after a busy answer |
| `assistant.api_url` | Anthropic's | For a gateway in between |

## Esri's MCP servers (ready when they are)

Esri has MCP for ArcGIS Location Services in beta and is working on MCP for ArcGIS Online and Enterprise. Put them behind this server with `upstream_servers`, and apps (Mappy included) keep talking to one address:

```json
"upstream_servers": [
  { "name": "esri", "label": "ArcGIS Location Services", "url": "https://location-services-mcp.arcgis.com/beta/mcp",
    "auth": "api_key", "api_key_env": "ESRI_LOCATION_API_KEY", "prefix": "esri_", "enabled": true },
  { "name": "enterprise", "label": "ArcGIS Enterprise", "url": "https://portal.example.org/portal/<path Esri gives>/mcp",
    "auth": "user_token", "prefix": "portal_", "enabled": true }
]
```

| Key | Meaning |
| --- | --- |
| `name`, `label` | Short id; name people see |
| `url` | The server's MCP endpoint (https) |
| `auth` | `none`, `api_key` (from the environment variable named in `api_key_env`, never in the browser), `user_token` (the signed-in user's own ArcGIS token, so people see only what Portal allows), or `user_or_key` |
| `prefix` | Added to its tool names (`esri_geocode`) so they never clash with this server's |
| `tools`, `exclude_tools` | Optional allow list and block list of its tool names |
| `allow_write` | false: tools that could change data are hidden. True: they come through, and Mappy still asks before running them |
| `trust_with_user_token` | User tokens only go to servers in the Portal's own domain unless this is true |
| `timeout_seconds`, `cache_minutes`, `headers`, `enabled` | Per request; how long its tool list is kept; extra headers; on or off |

Set the key for IIS: `Set-WebConfigurationProperty` or the app pool's environment variables, or in web.config under `<environmentVariables>` (`<environmentVariable name="ESRI_LOCATION_API_KEY" value="..." />`). `/health` shows each upstream's status. Sessions are per user and renewed when they expire; answers may be JSON or event streams; long tool lists are paged.

## Protocol

MCP Streamable HTTP (2025-11-25 and 2025-06-18; 2025-03-26 and 2024-11-05 also accepted). Stateless, with JSON responses. `GET /mcp` answers 405 because no server-initiated stream is offered. Tested with the official MCP SDK client and with Mappy.
