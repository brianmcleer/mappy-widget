/*
  acts.ts - names and words for the Clippy pack (the drawings and motion are in
  runtime/components/Acts.tsx). Pure data, so the brain and the tests can use it.
*/

/** Acts the chat can ask for by mood. */
export const ACT_MOODS = ['processing', 'writing', 'checking', 'alert', 'explain', 'knock', 'print', 'trash', 'mail', 'save', 'artsy', 'techy', 'wizardy', 'airplane', 'bike', 'congratulate', 'goodbye'] as const
/** Acts he does on his own between tasks. */
export const IDLE_ACTS = ['fingertap', 'headscratch', 'browraise', 'sway', 'atom', 'stack', 'airplane', 'glasses', 'headphones', 'bike', 'artsy', 'techy', 'wizardy'] as const
export type ActName = typeof ACT_MOODS[number] | typeof IDLE_ACTS[number]

/** Things people can ask him to do, in words ("get artsy", "fold into a paper airplane"). */
export const ACT_ASKS: Array<[RegExp, ActName, string]> = [
  [/^(?:get|go|be|do) ?artsy$|^paint (?:something|me a picture)$|^be an artist$/, 'artsy', 'Beret on. Every map is a painting that gives directions. 🎨'],
  [/^(?:get|go|be|do) ?techy$|^be a robot$|^beep boop$|^robot mode$/, 'techy', 'Beep boop. Techy mode: all my layers are now in binary. 🤖'],
  [/^(?:get|go|be|do) ?wizard(?:y|ly)?$|^do (?:some )?magic$|^abracadabra$|^cast a spell$/, 'wizardy', 'Abra-cadastral! ✨ Watch the parcels line up.'],
  [/^(?:fold into a |become a |turn into a |make a |be a )?paper (?:air)?plane$|^fly$|^take off$/, 'airplane', 'Clear for takeoff! ✈️ I am a map and a vehicle.'],
  [/^(?:ride|get on) (?:your|a|the) bike$|^bike ride$|^go for a ride$/, 'bike', 'Ring ring! 🚲 Bike lanes layer, here I come.'],
  [/^(?:do a trick|do something cool|show me a trick|entertain me|show off|do your thing)$/, 'airplane', 'Watch this. ✈️'],
  [/^(?:print|print this|print the map)$/, 'print', 'Printing! 🖨️ Just kidding, I only do the dance. The Print tool does the printing.'],
  [/^(?:empty the trash|take out the trash|trash it)$/, 'trash', 'Into the bin! 🗑️ And back out. I am recyclable.']
]

