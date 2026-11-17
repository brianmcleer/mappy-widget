# Mappy and Claude

Mappy answers from the app itself and never runs an AI model in the browser. Claude is optional, and there are three ways to use it. Pick one in Mappy's settings under **Where he gets help**.

| Way | Where the answer shows | Who pays, who signs in | Needs |
| --- | --- | --- | --- |
| Claude, answering in the chat | In Mappy's chat | Your organization, per question. People need no Claude account | gis-mcp server with an Anthropic API key |
| Claude, opened in the person's own Claude | In the Claude desktop app or claude.ai | Each person's own Claude plan and sign-in | Nothing on the server |
| Claude Desktop uses the GIS server | In Claude Desktop (Mappy is not involved) | Each person's own Claude plan | gis-mcp server reachable from the PC |

## 1. Claude, answering in the chat

Mappy still does map work himself. When he is stuck on a real question, or someone says "ask Claude ...", the question goes to your gis-mcp server. Claude runs there, looks things up with the server's read-only GIS tools, and the answer shows in Mappy's chat.

What an answer can carry:

- Buttons that run in Mappy when clicked: zoom to a place, turn on a layer, a map command ("chart parcels by zoning").
- A small bar chart or table.
- Up to three follow-up questions as chips. Follow-ups stay with Claude for five minutes.
- An answer in the language the question was asked in.

What is sent to Anthropic:

- The question, and up to three earlier turns.
- One line about the map: the place being looked at, the map center, the layers that are on, the tools in the app.
- With a popup open: the feature's layer and up to six of its values (turn off with **Send the clicked feature**).
- The data Claude's tools look up. Fields you list in `assistant.redact_fields` are left out.
- A small picture of the map, only if **Send a picture of the map** is on, and only for questions about what is on screen.

What is never sent: ArcGIS tokens, the API key, anything from a person who has not asked a question.

Controls on the server (`config.json`, under `assistant`):

- Signed-in people only (`require_token`, on by default).
- Questions per person per hour, per day, and a daily token budget (`max_tokens_per_day`).
- Fields that never reach Claude (`redact_fields`).
- Usage by day and month on `/health`, with an estimated cost when you set your prices.

Claude can only read. Every tool it has is read-only, and map buttons do nothing until a person clicks them.

### Set it up

1. Deploy gis-mcp 1.11 or later (see `mcp-server/README.md`).
2. Add the Anthropic API key as the `ANTHROPIC_API_KEY` environment variable on the server.
3. In `config.json`: `"assistant": { "enabled": true, "org_name": "the City" }`.
4. Restart the server. `/health` shows `"status": "ready"`.
5. Test from the server: `python gis_mcp.py --config config.json --ask "how many fire hydrants are there"`.
6. Review real answers before going live: `python gis_mcp.py --config config.json --eval questions.txt` writes every answer to a CSV.
7. In Mappy's settings: **Claude, answering in the chat (through my GIS server)**, then **Check that the server has Claude** and **Ask Claude a test question**.

The server needs outbound HTTPS to `api.anthropic.com`. Every answer from Claude carries a small note saying it is an AI answer; reword it in settings.

## 2. Claude, opened in the person's own Claude

When Mappy is stuck, his answer carries one link. It opens the Claude desktop app (or claude.ai) with the question written, under that person's own sign-in. Nothing is sent until they click. Set a prefix to use one of your skills or plugins (for example `/my-gis-skill`).

Choose **Open in**: the Claude desktop app, Claude in the browser, or another assistant's address.

## 3. Claude Desktop uses the GIS server

People who work in Claude Desktop can add the gis-mcp server as a connector and ask Claude directly. `python gis_mcp.py --config config.json --desktop-config` prints the config to paste into Claude Desktop (Settings, Developer, Edit Config).
