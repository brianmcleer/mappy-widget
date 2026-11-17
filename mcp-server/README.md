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
5. In Mappy's settings, **Where he gets help**: **Claude, answering in the chat (through my GIS server)**, then **Check that the server has Claude**.

Answers can carry buttons for the map (Claude calls `map_show_place` or `map_show_layer`; nothing changes until the person clicks) and up to three follow-up questions. To keep the cost down, the instructions and tool list are marked cacheable (repeat questions pay a fraction of the input), the same question from the same person within `cache_minutes` is answered from memory, and a busy moment is tried once more before giving up. `/health` shows today's questions and tokens under `assistant.today`.

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

Restart Claude Desktop. Needs Node.js. For layers that need a sign-in, add `"--header", "Authorization: Bearer ${GIS_TOKEN}"` to `args` and `"env": { "GIS_TOKEN": "<ArcGIS token>" }`, or run the server locally over stdio (below).

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
| `assistant.model` | claude-sonnet-5-5 | The Claude model |
| `assistant.label` | Claude | Its name in answers |
| `assistant.org_name` | the server name | Who runs the app, for Claude's instructions |
| `assistant.extra_instructions` | none | Added to Claude's instructions (house style, departments to point to) |
| `assistant.require_token` | true | Only signed-in people may ask |
| `assistant.per_person_per_hour`, `assistant.per_day` | 30, 1000 | Question limits |
| `assistant.max_steps`, `assistant.max_tokens`, `assistant.timeout_seconds` | 6, 1200, 60 | Tool rounds per answer, answer length, wait per API call |
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
