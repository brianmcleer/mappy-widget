# Contributing

Thanks for looking. This widget is maintained by the City of Grand Junction GIS Division and
shared as is; issues and pull requests are welcome, and there is no obligation on either side.

## Mappy didn't understand something

Use the **Mappy didn't understand me** issue form. The weekly language build tests the phrase and learns it when it can.

## Reporting a problem

Open an issue with:

- the Experience Builder version (Developer Edition or the portal's build),
- the widget version (from `manifest.json`),
- what you asked Mappy (the exact words), what he did, and what you expected,
- the browser console output if anything was logged.

## Pull requests

- Keep a pull request to one change.
- Match the existing style: two space indent, no semicolons, and the same comment voice as the
  file you are editing.
- Update `CHANGELOG.md` and bump the version in both `manifest.json` and `package.json`.
- Run the suites in the widget folder: `npm test` (regression, typos and MCP).
- Language changes (words, phrasings, test phrases) go in `language/seed.json` and `language/examples.json`; run `node language/build.mjs` (see `language/README.md`). Do not edit `mappy/src/brain/languagePack.ts` by hand.
- Build once with `pnpm start` in the Experience Builder `client` folder and exercise the widget
  before opening the pull request. `npx tsc -p .` in the widget folder should report no errors.

## Repository layout

The widget itself lives in the `mappy` subfolder. The repository root holds the README, the
license, and the publishing script; it is not part of the widget.
