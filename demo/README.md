# Mappy Playground

One web page for trying Mappy without ArcGIS, Experience Builder or a server. It is built from
the widget's own source (`../mappy/src`), so the character, the chat and everything he
understands are the real thing. Only the ground under him is pretend:

| Real | Pretend |
| --- | --- |
| The widget's brain, chat, acts and feelings | The map: an SVG drawing of Mapleton, a made-up town |
| Layer questions, filters, charts, tables | The layers: 36 parcels, zoning, 16 hydrants, streets, 3 parks, all invented |
| Typo reading, suggestions, small talk | The AI helper: answers written in the page, labeled as a demo. No AI is called |

Nothing leaves the page. No account, no key.

## Build it

Program: PowerShell or Command Prompt (regular, not as administrator), in this folder.

1. `npm install` (once)
2. `node build.mjs`
3. Open `dist/index.html` in a browser.

Options: `--readable` (not minified), `--cdn` (load React from cdnjs for a smaller page),
`--fragment` (also write `dist/fragment.html`, the page without html, head and body tags, for
hosts that add their own).

## Test it

The browser test opens the built page, talks to Mappy and checks the map and the chat (22 checks,
desktop and phone width).

1. `npm i -D playwright`
2. `npx playwright install chromium`
3. `node e2e.mjs`

## How it works

- `src/fakemap.ts`: a small stand-in for the Maps SDK view and layers (queries, filters, a SQL
  where reader, graphics, goTo).
- `src/town.ts`: Mapleton. Every street, owner and hydrant is invented.
- `src/jimu-core.ts`: what the page gives the widget in place of Experience Builder.
- `src/pretend-claude.ts`: the simulated AI helper. It reads the made-up layers and says it is a demo.
- `src/main.tsx`: the page around him.

Try: "turn on zoning", "how many parcels by zoning", "who owns 250 Oak St", "closest hydrant to
City Hall", "ask Claude which zoning district has the most parcels", "call me Sam", "fly a kite".
