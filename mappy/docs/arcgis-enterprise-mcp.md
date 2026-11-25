# Mappy and MCP for ArcGIS Enterprise

Esri's MCP for ArcGIS Enterprise is an MCP server that runs on your hosting server and offers your organization's GIS as tools: search the portal, describe and query layers, geocode, route, export a map image, and run web tools. Mappy can use it directly. This page says what he does with it, how to connect it, and what is not proven yet.

Esri's documentation: https://doc.esri.com/en/mcp-arcgis-enterprise/latest/

## What Mappy does with it

Mappy has no language model. He does not read tool descriptions and improvise. He knows the tools of Esri's default catalog by name and uses each one for a job:

| Someone asks | Tools he calls | What they get |
| --- | --- | --- |
| "How many bus stops are there?" when no layer on the map has bus stops | `search_portal_content`, `describe_layer`, `query_data` | The count, from the portal layer, labelled as not on this map |
| "How many of them are on the red route", "what about blue", "list them", "which has the most riders", "average riders by route" | `query_data` | The same answers he gives for map layers: counts with a share, lists, rankings, averages, groups |
| "Find maps about zoning", "search the portal for flood data", "what dashboards do we have" | `search_portal_content` | A list. Layers can be asked questions; other items open in the portal |
| "Directions from City Hall to the library", "walking directions to ..." | `find_address_candidates`, `solve_route` | Distance, time, the steps, and the route drawn on the map along your own roads |
| "What address is this", a place named in any question | `reverse_geocode`, `find_address_candidates` | The address, from your organization's locator |
| "Use the server get map image" | `get_map_image` | The picture, from its temporary address |
| A web tool tagged `mcp` (geoprocessing) | the tool, then `get_gp_task_job_status` | He fills its inputs, asks for what is missing, and waits up to a minute for a job |

`describe_layer` is always called before `query_data`, as Esri requires, and once per layer.

Questions about layers on the map stay with the map: they are quicker and need no server. The portal is asked only when the map cannot answer, when the question says "in the portal", or when the conversation is already about a portal layer.

## What people can see

The connection carries the signed-in person's own ArcGIS sign-in. Esri's server applies their portal permissions, so they see what they could see in the portal and nothing more. Nothing is saved in the app.

`search_portal_content` only returns items tagged `mcp`. Tag the layers and maps you want found, and give them clear titles and summaries.

## Connect it

Requirements, from Esri's documentation: MCP Services for ArcGIS Enterprise installed on the hosting server (every machine in the site; installing restarts ArcGIS Server), ArcGIS Enterprise 11.1, 11.3, 11.5, 12.1 or 12.2, and on 12.2 or later "External AI client access" turned on.

1. In the builder, open Mappy's settings, **MCP server**.
2. Press **Fill in ArcGIS Enterprise MCP (this portal)**. He asks the portal for its hosting server and fills in `https://<domain>/<server-context>/mcp/default`, signed in as the ArcGIS user. If he cannot find it, type the hosting server's address (`https://your-server/server`) and press it again. A custom catalog (12.2 or later) is `https://<domain>/<server-context>/mcp/<item id>`: paste that instead.
3. Press **Connect and list tools**. The status line says when it recognises an ArcGIS Enterprise catalog.
4. Set **Where he gets help** to the MCP server.
5. Try: "search the portal for zoning", then a question about a layer that is not on the map.

## If the browser cannot reach it

A web app can only call another server when that server allows the app's address (CORS). Esri's documentation does not say whether the MCP endpoint does. If Connect says it could not reach the server:

- Host the app on the same address as the hosting server, or
- Put Esri's endpoint behind [gis-mcp](../../mcp-server/README.md) as an upstream server (`"auth": "user_token"`). The app talks to gis-mcp, gis-mcp passes each person's own token on, and Mappy recognises the tools behind the prefix.

## Sign-in details

Mappy sends the ArcGIS token as `Authorization: Bearer`. If the server refuses that at the handshake he tries ArcGIS's own header, `X-Esri-Authorization: Bearer`. Esri's documentation shows the token as `?token=` in the address for browsers; Mappy only does that when the builder turns on "If a header is refused, send it in the address", because addresses can be written to logs.

OAuth with a registered app and API keys are other ways Esri supports. An API key in a header works with "A key in a header", but it is saved in the app and everyone would share that key's access, so the signed-in user is the better choice inside a portal app.

## What is not proven yet

This was built from Esri's documentation (2026.0) and tested against a stand-in server that follows it, in `tests/esri-mcp.cjs`. It has not yet run against a real MCP for ArcGIS Enterprise.

- Esri documents each tool's inputs but not the exact shape of every answer. Mappy reads the shapes ArcGIS REST uses and several likely variants. The first real run may show a shape he does not read; that is a small fix in `src/brain/esriMcp.ts`.
- Which header the endpoint accepts for a portal token is not documented. The fallbacks above cover the likely ones.
- CORS, as above.

## Limits

- No edits. Tools that could change data are off unless the builder turns them on, and always ask first.
- Portal layers are answered in the chat. They are not added to the map.
- `query_data` returns at most 1,000 records a page; lists show the first few and say how many there are.
- Spatial questions about portal layers ("bus stops within 500 ft of here") are not asked yet.
