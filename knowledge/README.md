# Knowledge feed

`feed.json` is the one file Mappy fetches at runtime (once a day per browser, cached, never waited for) so he keeps improving without an app update. It carries:

- the current language pack (words, phrasings, misspellings) from `language/`
- `faq`: questions and answers (the app author's own answers in settings always outrank these)
- `glossary`: plain-language terms (built-in terms keep their meaning; new words are added)
- `facts`: place-neutral fun facts for "tell me a fact"
- `tips`: short lines for the idle tips and "tip"

Edit **`knowledge.json`** in a pull request; never edit `feed.json` by hand. The Knowledge feed workflow rebuilds `feed.json` when `knowledge.json` changes, and the weekly Language pack workflow rebuilds it when the pack changes. `node knowledge/build.mjs` builds it locally (`--check` says whether it is current; `--typescript <path>` names the TypeScript package when it is not in `node_modules`).

Keep everything place-neutral, work-safe and short. Entries that the widget would drop (too short, too long, not https, tags) fail the build, so a bad entry never ships.

## Format

```json
{
  "format": 1,
  "version": "2026.10.29",
  "about": "one line shown in settings",
  "languagePack": { "...": "language/language-pack.json" },
  "faq": [{ "q": "question", "a": "answer", "url": "https://optional.link" }],
  "glossary": [{ "term": "word", "aliases": ["other name"], "text": "what it means" }],
  "facts": ["a fun fact"],
  "tips": ["a short tip"]
}
```

Limits: 500 answers (question 300 characters, answer 2,000), 500 terms (text 600), 300 facts (400), 100 tips (300), 2 MB in all. `version` is `YYYY.MM.DD` or `YYYY.MM.DD.N` and rises with every change.

## Your own feed

The widget's settings have a **Knowledge feed** section: turn it off, or point it at your own copy for apps that cannot reach GitHub. Any https address that serves this JSON works, for example a static folder on your web server kept current by a scheduled task (PowerShell, Run as administrator) that pulls this repository and copies `knowledge/feed.json` there. Everything in the feed is validated in the browser before it is used; a feed that fails is ignored and the bundled knowledge stays.
