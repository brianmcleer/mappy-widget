# Mappy's language pack

Mappy reads requests the way a forgiving person does. "trun on parcles", "lsit layres", "zoomin", "lay ers", "opne the legnd", "pls" and "unhide parcels" all work. The typo fixer is built into the widget. This folder builds the **language pack** it reads with, and a GitHub Action keeps the pack improving.

## What is in the pack

| Part | Where it comes from |
| --- | --- |
| Every English word (about 72,000, with irregular forms) as a compact yes/no filter, so real words and place words ("county", "mesa", "canyon") are never "fixed" | [Open English WordNet](https://github.com/globalwordnet/english-wordnet) (CC BY 4.0) |
| Synonyms for map words ("parcel" = "tract", "measure" = "mensurate") | WordNet, for the meanings chosen in `seed.json` |
| Irregular forms ("drew" means "draw", "shown" means "show") | WordNet |
| Other ways to say a command ("unhide" = "turn on", "get closer" = "zoom in") | `seed.json` |
| Shorthand and common slips ("pls", "teh", "whats") | `seed.json` |
| Phrases people reported | GitHub issues labelled `language`, kept in `learned.json` |

## How it improves

Every Monday, and whenever someone reports a phrase, the **Language pack** Action:

1. downloads the latest Open English WordNet release;
2. reads every open issue labelled `language` (the "Mappy didn't understand me" form);
3. works out the smallest change that makes each reported phrase work: a misspelling, a synonym, or a pattern such as `make * visible` means `turn on *`;
4. runs the phrase test set (`examples.json` plus every reported phrase) through the widget's own code, and keeps each change only when nothing that passed before fails;
5. runs the widget's regression suites;
6. opens one pull request with the new pack and a report: how many phrases Mappy understands now, what was learned, what was left out and why, and `Closes #n` for each report it learned.

Merge the pull request and the pack ships. Pull requests opened with the built-in token do not start the **Test** workflow; the Action runs the same checks itself before opening one. Add a repository secret `LANGUAGE_PR_TOKEN` (fine-grained, contents and pull requests write) if you also want **Test** to run on them. Set the repository variable `LANGUAGE_AUTOMERGE` to `true` to merge automatically when the checks pass. Automatic merging only happens when every phrase learned came from the repository's owner, members or collaborators; reports from anyone else are marked in the pull request and wait for review.

Every test phrase is also retyped with the slips people make (swapped letters, a missed key, a neighbouring key, a doubled letter), the same way every run. Those count like test phrases. Harder typos (two slips, or a missing first letter) are counted in the report to show progress, without blocking a build.

A pack never ships if a check that passed before fails with it. `passing.json` lists every check the current pack passes; the **Test** workflow fails any code change that breaks one of them.

## Getting the improvements

Pick whichever fits how you installed Mappy:

- **In the builder, per app, no rebuild:** Mappy's settings, **Language**, **Get language updates**. The pack is saved with the app; people using the app download nothing.
- **Cloned the repo:** `git pull`. The pack is `mappy/src/brain/languagePack.ts`.
- **Installed from a release zip:** `node sync.mjs "<your widget folder>"` (download just this file, Node 18 or later), then rebuild. It fetches the newest pack and updates `src/brain/languagePack.ts` only when it is newer.
- **New release zips** always carry the newest pack.

## Teach Mappy a phrase

Open an issue with the **Mappy didn't understand me** form, or use **Language**, **Teach Mappy a phrase** in Mappy's settings, which fills the form in. Give what was typed and what it should mean, written as a request Mappy already understands (`turn on parcels`, `list layers`, `open the legend`). Leave out anything private.

## Run it yourself

```
npm i --no-save typescript
node language/build.mjs                      # full build (downloads WordNet once into language/.cache)
node language/build.mjs --issues issues.json # include reported phrases (gh issue list --label language --json number,title,body)
node language/build.mjs --check              # score the current pack only
```

Edit `seed.json` to add map words (with the WordNet meaning to use), phrasings and shorthand. Edit `examples.json` to add test phrases. Everything is tested on every build.

## Credits

Open English WordNet is © the Open English WordNet contributors and Princeton University, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The pack keeps that notice in its `sources` list.
