/*
  voice.ts - how Mappy talks. Short, friendly, a little goofy, never rude.
  Every line is plain English; the widget's UI strings live in translations/default.ts.
*/

export function pick<T> (arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

export const V = {
  greet: (name: string, app: string) => pick([
    `Hi! I'm ${name}. I know my way around ${app}. What are you looking for?`,
    `Hey there! ${name} here, your folded-up guide to ${app}. Ask me anything.`,
    `Oh, hello! It looks like you're exploring ${app}. Want a hand?`
  ]),
  hello: () => pick(['Hello again!', 'Hey! What can I find for you?', 'Hi! Point me at something.']),
  thanks: () => pick(["Anytime! That's what I'm folded for.", 'Happy to help!', 'You got it.', 'Glad that worked!']),
  whoami: (name: string) => `I'm ${name}, a tiny map who lives in this app. I've read every page, tool, layer and link in it, so I can find things, open tools and switch layers for you. I run entirely in your browser.`,
  thinking: () => pick(['Unfolding...', 'Checking the legend...', 'Reading the fine print...', 'Consulting my compass...']),
  searching: (q: string) => pick([`Searching the map for "${q}"...`, `Looking for "${q}"...`, `Scanning layers for "${q}"...`]),
  notFound: (q: string) => pick([
    `Hmm, I couldn't find anything about "${q}". Try other words, or ask "what can you do?"`,
    `I came up empty on "${q}". Maybe try a layer name, a tool, or an address?`,
    `No luck with "${q}". I might know it by a different name.`
  ]),
  unsure: () => pick(["Here's what I found that looks close:", 'Not 100% sure, but these look related:', 'These might be what you mean:']),
  opened: (label: string) => pick([`Opening ${label}.`, `Here's ${label}.`, `${label}, coming right up.`]),
  cantOpen: (label: string, where: string) => `I tried to open ${label}, but it's tucked away ${where || 'somewhere I can not reach'}. Look for it there.`,
  layerOn: (t: string) => pick([`${t} is on.`, `Turned on ${t}.`, `${t} is now showing.`]),
  layerOff: (t: string) => pick([`${t} is off.`, `Turned off ${t}.`, `Hid ${t}.`]),
  noMap: () => "I can't see a map yet. Ask the app builder to connect me to one in my settings.",
  noLayer: (t: string) => `I don't see a layer called "${t}" on the map.`,
  sleep: () => pick(['Okay, folding up. Click me if you need me!', 'Going quiet. Just click me.', 'Nap time. Wake me anytime.']),
  joke: () => pick([
    'Why did the map break up with the globe? It needed some space, and the globe kept going around in circles.',
    "I'd tell you a joke about contour lines, but it has too many ups and downs.",
    "What's a map's favorite exercise? Folding. Three sets, never perfectly.",
    'Why are maps bad at poker? Everyone can read them.',
    "I asked the scale bar how it was doing. It said it's been measured.",
    "Legends say I was once a gas station map. Legends also explain the colors, so trust them.",
    "Why don't maps get lost? They always know where they stand. Mostly at 1:24,000."
  ]),
  tipLead: () => pick(['Did you know?', 'Quick tip:', 'Psst...', 'Here is something handy:']),
  busyMap: () => pick([
    "It looks like you're hunting for something. Want me to find it?",
    'Lots of panning! Tell me what you are looking for and I will search the map.',
    "Lost? I've got a great sense of direction. Just type what you need."
  ]),
  found: (n: number, q: string) => n === 1 ? `Found 1 match for "${q}":` : `Found ${n} matches for "${q}":`,
  count: (n: number, t: string, scope?: string) => `${t} has ${n.toLocaleString()} feature${n === 1 ? '' : 's'}${scope === 'view' ? ' in the current view' : ''}.`
}
