# Conversational GIS through MCP

Mappy remains model-free. It parses bounded GIS requests and calls the tools exposed by the configured MCP server. It does not generate arbitrary code or SQL.

Start with “nearest sewer line to 250 N 5th St”. Continue with:

- “What about hydrants?” — keep the place, change the feature type.
- “Within 1,000 feet?” — keep the place and feature type, use a radius search.
- “Actually at 123 Main St” — replace the place, preserve the radius.
- “And parks” — keep the place and radius, change the feature type.

After a grouped summary, “by material” changes the grouping field. The server still resolves names against its available layers and fields.

“Here” is resolved when the question is asked. Later follow-ups retain that original point even when results move the map. A new complete request using “here” uses the current map center.

If a tool needs details, Mappy asks for one at a time. Reply with the value or say “cancel”. New commands exit that input collection. Changing maps, servers, tool permissions, or starting over clears pending requests. A failed query does not replace the last successful place question.

The companion server's tools must be enabled and configured by the app author. Tests use simulated ArcGIS services; they do not establish availability or permissions for a production city service.
