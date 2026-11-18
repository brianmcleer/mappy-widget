# Accessibility

Mappy aims to meet WCAG 2.1 AA and the WCAG 2.2 AA additions. This page says what is checked, how to run the checks, and what has not been checked.

## What is checked on every change

`demo/a11y.mjs` opens the playground in a real browser (the same chat and character code the widget uses) and checks:

| Check | How |
| --- | --- |
| Automated WCAG 2.0, 2.1 and 2.2 A and AA rules, plus best practices | axe-core, with a count, a chart, a table, a list, a card, an address answer and a miss on screen |
| The same rules in light, dark and high-contrast (forced) colors | Three passes |
| Opening with the keyboard puts the cursor in the question box | Enter on Mappy |
| Every control in the chat can be reached with the keyboard and shows a focus ring | Shift+Tab through all of them |
| Every control is at least 24 by 24 px (WCAG 2.2, 2.5.8) | Measured |
| The chat is a named dialog, and answers are announced politely | Roles and live region |
| Esc closes the chat and returns focus to Mappy | Keyboard |
| No sideways scrolling and nothing cut off at 320 px wide (reflow, 1.4.10) | Narrow window |
| Nothing keeps moving when the device asks for reduced motion | Running animations counted |

Run it:

```
cd demo
npm ci
npm i --no-save playwright axe-core
npx playwright install chromium
node build.mjs
node a11y.mjs
```

The same test runs in the repository's Playground workflow on every push.

## Results (November 2026)

- The chat and character pass every check above.
- Three number boxes in the builder's settings panel had no name for screen readers. They now do.
- One automated rule (label in name) flags the character on days he wears a costume with drawn letters, such as a "GIS" badge. The letters are decoration inside a picture that is hidden from screen readers, and the button's name is "Mappy. Open the chat", so this is left as is and excluded in the test.

## What has not been checked

- Real screen readers (NVDA, JAWS, VoiceOver, TalkBack). The roles, names and live region are in place and tested by rule, but nobody has listened to a full session yet. Do this before calling an app conformant.
- The settings panel inside Experience Builder, beyond a scan for controls without names. Experience Builder's own components draw most of it.
- The map itself and the other widgets in an app. Mappy can only answer for his own chat and character.
- Voice input and read-aloud depend on the browser.

## Things that help by design

- Everything Mappy does on the map can be asked for in words, so nothing needs a drag or a precise click. He can be moved with the arrow keys or by asking ("move to the left").
- Charts come with their numbers as text and as a table.
- Status symbols in lists come with words.
- Motion can be paused from his menu, and stops on its own with the device's reduced-motion setting.
- Text size follows the page, so browser zoom works up to 400%.

See the README for the keyboard shortcuts.
