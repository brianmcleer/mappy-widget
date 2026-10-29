# Connecting Mappy to an MCP server

Mappy works on his own: he reads the app and its map in the browser, with no AI service. An MCP server is a second, optional way for him to help. MCP is short for Model Context Protocol, an open standard for handing tools to assistants. When you connect a server, Mappy can use its tools, for example:

- **ArcGIS Location Platform MCP** (beta since June 2026): geocoding, routing, elevation and static map pictures.
- **ArcGIS Online and ArcGIS Enterprise MCP** support as Esri rolls it out (content search, feature layer queries, geoprocessing, map export).
- **Community servers** such as [arcgis-portal-mcp](https://github.com/Asem-D/arcgis-portal-mcp) (portal content, feature queries and administration).
- Your own server.

Mappy still has no language model. He picks the tool whose name and description best fit the request, fills in its inputs from what was typed, and turns the answer into a sentence, a table (with a CSV download), a picture, or a "Zoom there" button.

## What people can say

| Say | What happens |
| --- | --- |
| `what is the closest sewer line to my address` | Plain questions about places go straight to a server tool made for them, with no "ask the server" needed: closest (`nearest ...`, `... near 250 N 5th St`), within a distance (`hydrants within 500 ft of here`, `parks within a quarter mile of my house`), what is at a place (`who owns 123 Main St`, `what zone is 250 N 5th St in`, `what's at ...`, `is ... in a flood zone`) and group counts (`count sewer mains by material`). |
| `my address is 250 N 5th St` | Remembers "my address", "my house" and "where I live" in this browser. If you ask about "my address" first, he asks for it. With no place at all ("nearest hydrant") he asks "Closest to where?" with buttons for your address and the middle of the map. |
| `list server tools` | Lists the tools you turned on, as buttons. |
| `ask the server where is 250 N 5th St` | Picks the best tool (geocoding) and runs it. |
| `use route from City Hall to the library walking` | Runs that tool by name. Inputs come from the words: `from ... to ...`, `name=value` pairs, coordinates such as `39.06, -108.55`, listed choices such as `walking`, and the rest of the sentence for the one free-text input. |
| `use delete_features with where=STATUS = 0` | Tools that could change data always show **Run** and **Cancel** first. Nothing is sent until **Run** is pressed. |
| `elevation here`, `map picture of this area`, `what's the address here` | Inputs for a place, extent or zoom come from the map as it is now when the request says "here" or "this area", or leaves a required one out. |
| anything Mappy cannot answer himself | When **Offer the server when Mappy is stuck** is on, he adds an **Ask (server name)** button. Nothing is sent until it is pressed. |

When a tool needs an input he could not find, he names it and shows how to type it (`use route with from=..., to=...`).

## Your own server (gis-mcp, free)

The repository's `mcp-server` folder has a small read-only MCP server for your own ArcGIS Enterprise. It provides `geocode` and `reverse_geocode` with your locator, `nearest_feature`, `features_near` and `summarize_layer` for plain place questions, plus `identify` (by address or point), `find_features`, `count_features`, `list_layers` and Portal `search_content`. It runs under IIS on a web server you already have, so there's no extra cost.

It has no service account. Choose **Sign in with: The signed-in ArcGIS user**, and each person only sees what Portal already lets them see. Setup is in `mcp-server/README.md`. After that, the address for Mappy is `https://<your server>/gis-mcp/mcp`.

## ArcGIS Location Services (beta)

Press **Use ArcGIS Location Services (beta)** in **MCP server** settings. It fills in:

- address `https://location-services-mcp.arcgis.com/beta/mcp` (Streamable HTTP),
- sign in with **A key in a header**: `Authorization`.

Paste `Bearer ` followed by an API key from ArcGIS Location Platform into **Header value**. The key needs the privileges Esri lists for the MCP beta (beta access, geocoding, routing, elevation, static maps; geocoding and data enrichment need pay-as-you-go). Restrict the key to your app's address, because the key is saved in the app. Esri filters the tools by the key's privileges; tools seen so far include `find_address_candidates`, `reverse_geocode`, `solve_route`, `elevation_at_locations` and `map_with_overlay` (a PNG map picture, which Mappy shows in the bubble).

The server answers browser requests from other sites (its CORS preflight allows the `authorization` header), so no bridge is needed. Join Esri's early access program for the MCP beta first.

## Set it up

1. In the builder, select Mappy, open **MCP server** in his settings.
2. Enter the server address (it must start with `https://`; `http://` works only for `localhost`) and a name people will see in the chat.
3. Choose how to sign in:
   - **Nothing** for a public server.
   - **The signed-in ArcGIS user** sends the user's ArcGIS token as `Authorization: Bearer ...`. Use this for ArcGIS Online or Enterprise servers that accept ArcGIS tokens.
   - **A key in a header**, for example `Authorization` and `Bearer YOUR_API_KEY`. The key is stored in the app and anyone who opens the app can read it. Use only an API key restricted to the app's address (referrer) and to the services it needs.
4. Press **Connect and list tools**. Every tool is listed. Tools that cannot change data start on; tools that could (their name says delete, update, publish, share and so on, or the server marks them) start off and always ask first. Tick **Ask first** on any other tool you want confirmed.
5. Save the app.

## The server must allow the app

Mappy talks to the server from the browser with the MCP **Streamable HTTP** transport (protocol version 2025-06-18). The server has to:

- accept `POST` requests with JSON-RPC from the app's address (CORS: `Access-Control-Allow-Origin` for your app's origin, and `Access-Control-Allow-Headers` that include `content-type`, `accept`, `authorization`, `mcp-session-id` and `mcp-protocol-version`);
- expose the session header (`Access-Control-Expose-Headers: Mcp-Session-Id`).

If "Connect" says the server cannot be reached, CORS is the usual reason.

### Servers that only run on a desktop (stdio)

Many MCP servers, arcgis-portal-mcp among them, run as a local command for desktop assistants. Put an MCP bridge in front of them, such as [mcp-proxy](https://github.com/sparfenyuk/mcp-proxy) (MIT):

```
uv tool install mcp-proxy
mcp-proxy --port=8808 --allow-origin="https://your-app-host" -- python -m arcgis_portal_mcp.server --read-only
```

Then connect Mappy to `http://localhost:8808/mcp` for testing on your own machine, or host the bridge behind HTTPS for everyone. Check the bridge's documentation for the exact path it serves. Run portal servers read-only unless people really need to change data, and give the server its own account with only the access it needs.

## Privacy and safety

- What people type is sent to the server only when a tool runs: when they ask the server directly, use a tool by name, or press **Ask (server name)** or **Run**.
- Tools that could change data are off until you turn them on, and always ask first.
- Answers from the server are shown as text, tables and pictures (PNG, JPEG, GIF or WebP only). Nothing from the server runs as code.
- Turn the whole thing off with **Use an MCP server**, or press **Remove server**.

## Esri references

- [ArcGIS Architecture Center: agentic AI](https://architecture.arcgis.com/en/industry-and-tech-patterns/ai-lens/agentic-ai.html)
- [MCP support (beta) in ArcGIS Location Platform](https://www.esri.com/arcgis-blog/products/platform/developers/mcp-support-beta-and-arcgis-static-maps-service-in-arcgis-location-platform-release)
- [Getting started with the ArcGIS Location Services MCP](https://developers.arcgis.com/ai-tools/mcp-arcgis-location-services/get-started/)
