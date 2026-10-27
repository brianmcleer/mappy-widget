# Mappy widget

[![License](https://img.shields.io/github/license/brianmcleer/mappy-widget)](LICENSE) [![Release](https://img.shields.io/github/v/release/brianmcleer/mappy-widget?display_name=tag)](https://github.com/brianmcleer/mappy-widget/releases) [![Issues](https://img.shields.io/github/issues/brianmcleer/mappy-widget)](https://github.com/brianmcleer/mappy-widget/issues)

A friendly folded-map assistant for any ArcGIS Experience Builder app, made by the City of Grand Junction, CO. Drop him into an experience and he floats over the page, waves hello, and answers questions about everything in that app: its pages, views and windows, every widget and where it lives, the text and links configured in it, the layers and fields on the map, and the answers the app author types in. He can also do things: open a widget, work through the layer list to switch layers on and off, zoom, count, filter, sort and page through records, and find features and addresses.

Everything runs in the browser. There is no model download, API key, outside AI service or LLM server; it is a local command and retrieval assistant that works with the app's own ArcGIS services. Telemetry is off by default.

The downloadable widget lives in the `mappy` subfolder. See [mappy/README.md](mappy/README.md) for the feature list, setup and install steps, and [mappy/docs/local-assistant.md](mappy/docs/local-assistant.md) for what users can ask.

## Always improving: the language pack

Mappy forgives typos and reads with a language pack built from open word data ([Open English WordNet](https://github.com/globalwordnet/english-wordnet), CC BY 4.0) and from phrases people report. The **Language pack** GitHub Action rebuilds it every week, tests every change against the phrase test set and the regression suites, and opens a pull request only when Mappy understands more. Report a missed phrase with the **Mappy didn't understand me** issue form.

Get the improvements without waiting for a release:

- in the builder: Mappy's settings, **Language**, **Get language updates** (saved with the app, no rebuild);
- a clone: `git pull`;
- a zip install: `node language/sync.mjs "<your widget folder>"`, then rebuild.

See [language/README.md](language/README.md).

## MCP server (optional)

Mappy can also use the tools of an MCP (Model Context Protocol) server you connect in his settings, such as ArcGIS Location Platform's MCP or a portal MCP server. He asks first before any tool that could change data. See [mappy/docs/mcp.md](mappy/docs/mcp.md).

## Repository layout

```
mappy-widget/                    <- this repo
├── README.md                    <- this file (GitHub landing page)
├── LICENSE                      <- Apache-2.0
├── .gitignore                   <- ignores node_modules, .vs, dist, OS cruft
├── publish.ps1                  <- one-command publish/update automation
├── .github/workflows/           <- Test (every push) and Language pack (weekly)
├── language/                    <- language pack: seed words, test phrases, build and sync scripts
└── mappy/                       <- the widget (drops into your-extensions/widgets)
    ├── package.json
    ├── manifest.json
    ├── README.md                <- install steps and feature list
    ├── CHANGELOG.md
    ├── LICENSE
    ├── docs/local-assistant.md  <- what users can ask, with examples and limits
    ├── docs/mcp.md              <- connecting an MCP server
    ├── scripts/                 <- build-time help pack loader
    ├── tests/                   <- Node regression suite
    └── src/ ...
```

## Install (for users)

See [mappy/README.md](mappy/README.md). In short: download the release zip, place the `mappy` folder so its `manifest.json` sits directly inside `client/your-extensions/widgets/mappy/`, then run `pnpm install` in the `client` folder and restart. Drop Mappy anywhere in an experience; he floats over the app when it runs.

Mappy works best with [Map Layers Custom](https://github.com/brianmcleer/map-layers-custom-widget) 1.50 or later in the same app: he then sees layers exactly as that list shows them and highlights the row he changes. Any other layer list works too, with Mappy switching the map himself.

### The release zip and the editor shims

The zip is the widget only. The Visual Studio type shims in the repo (`mappy/src/exb-editor-shims.d.ts`, `mappy/src/vendor-shims.d.ts`) and the `tests` folder are left out on purpose: the shims' ambient `declare module` blocks are not file-scoped and would rewrite the react, jimu and esri types for every other widget in your `your-extensions` folder.

If you clone the repository instead of using the zip, delete `mappy/src/exb-editor-shims.d.ts` and `mappy/src/vendor-shims.d.ts` before building; nothing else depends on them.

## Requirements

- ArcGIS Experience Builder Developer Edition 1.21 (Maps SDK 5.x).

## Publishing updates (for the maintainer)

The widget is developed in the Experience Builder install, then synced into this repo and pushed with `publish.ps1`. Edit the three variables at the top of the script the first time on a new machine, then:

```
# Code update only
powershell -ExecutionPolicy Bypass -File .\publish.ps1

# Code update plus a new downloadable release
powershell -ExecutionPolicy Bypass -File .\publish.ps1 -Release v1.6.0
```

The script first pulls this repo and copies a newer language pack (merged by the Language pack Action) into the EB folder, then mirrors the widget from the EB folder into the `mappy` subfolder (skipping `node_modules`, `.vs` and `Claude outputs`), commits, pushes, and optionally cuts a versioned GitHub release with a downloadable zip. Tags must increase and never repeat.

## Credits and license

Made by the City of Grand Junction GIS Division. The character and art are original. The built-in help for Experience Builder's out-of-the-box widgets is written in plain words from Esri's Experience Builder documentation, not copied from it.

Licensed under Apache-2.0. See [LICENSE](LICENSE) for the full terms. Copyright City of Grand Junction, CO. This software is free to use, modify, and redistribute under those terms.
