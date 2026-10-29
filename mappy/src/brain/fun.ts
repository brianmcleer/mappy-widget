/*
  fun.ts - Mappy's easter eggs. Jokes (no repeats until he runs out), knock-knock jokes both
  ways, riddles, fun map facts, a dance, a barrel roll, a song, a magic compass, coin flips,
  dice, rock paper scissors, Null Island, party mode and more. Everything is original, PG
  and work-safe. Pure TypeScript: it returns words and a mood; the widget does the moving.
*/

import { parseIntent } from './intents'
import { parseAnalysis } from './analysis'
import { ACT_ASKS } from './acts'

export interface FunReply {
  text: string
  mood: string
  /** Something the widget should do too. */
  effect?: 'party' | 'nullIsland'
  suggest?: string[]
}

const JOKES = [
  'Why did the map break up with the globe? It needed some space, and the globe kept going around in circles.',
  "I'd tell you a joke about contour lines, but it has too many ups and downs.",
  "What's a map's favorite exercise? Folding. Three sets, never perfectly.",
  'Why are maps bad at poker? Everyone can read them.',
  "I asked the scale bar how it was doing. It said it's been measured.",
  "Why don't maps get lost? They always know where they stand.",
  'What did the GIS analyst say at the buffet? "I\'ll take a 500-foot buffer, please."',
  'Why was the polygon so relaxed? No loose ends. It was closed.',
  "Why did the layer feel left out? Nobody turned it on.",
  "What do you call a map that sings? A Carto-tune.",
  "Why was the shapefile so tired? It had been split into seven files all day.",
  "How does a map apologize? It says, \"My bad, I was off by a few meters.\"",
  "Why did the road refuse to fight? It didn't want any intersections.",
  "What's a hydrant's favorite music? Anything with a good flow.",
  "Why did the parcel hire a lawyer? Someone crossed its line.",
  "What did the north arrow say to the lost hiker? \"Up here!\"",
  "Why are latitude lines so calm? They never cross each other.",
  "What do you call a sleepy compass? Napping-dicular.",
  "My favorite projection? Whatever keeps me looking my best. Sorry, Greenland.",
  "Why was the river so rich? It had two banks.",
  "What did the mountain say to the valley? \"You're looking low today. Want a lift?\"",
  "Why did the zoning map blush? It saw the overlay district.",
  "I tried to write a joke about coordinates, but I couldn't find the right point.",
  "Why did the sewer line get promoted? It was really good at handling things downstream.",
  "What's a map's favorite snack? Grid-dles. With extra legend-ary syrup."
]

/** Map and world facts that are true anywhere. Local ones come from the app's settings ("Local fun facts"). */
const FACTS = [
  'Colorado and Wyoming look like rectangles, but survey quirks along their borders give each hundreds of tiny corners.',
  'Many city street grids are rotated a few degrees from true north to line up with a river, a railroad or an old survey line.',
  'On a Web Mercator map Greenland looks about as big as Africa. Africa is actually about 14 times larger.',
  'One degree of latitude is about 69 miles anywhere on Earth. A degree of longitude shrinks to zero at the poles.',
  "Everest's summit is the highest above sea level, but Chimborazo in Ecuador is farthest from Earth's center, thanks to the planet's bulge at the equator.",
  'The word "map" comes from the Latin "mappa", meaning a cloth or napkin.',
  'The Four Corners Monument is the only spot in the United States where four states meet.',
  'The first national monument in the United States, Devils Tower, was set aside in 1906. Most states have at least one.',
  'GPS satellites orbit about 12,500 miles above Earth, and your phone needs at least four of them for a good fix.',
  'Contour lines never cross on a normal map. If they touch, you are looking at a cliff.',
  'Null Island, at 0° latitude and 0° longitude, is not a real island. It is where bad geocodes go to vacation.',
  'A flat-topped mountain is a mesa; a small one is a butte. The difference is mostly how wide the top is.',
  'Australia moves north about 7 centimeters a year, so its mapping datum had to be updated to keep up.',
  'The equator is about 24,900 miles around. Walking it nonstop at 3 mph would take almost a year.'
]

const RIDDLES: Array<[string, string]> = [
  ['I have cities but no houses, forests but no trees, and rivers but no fish. What am I?', 'A map! (Hi, it me.)'],
  ['The more of me you take, the more you leave behind. What am I?', 'Footsteps. Great for field work.'],
  ['I point the way but never move my feet. What am I?', 'A compass. Or a very committed street sign.'],
  ['What runs but never walks, has a mouth but never talks, and has a bed but never sleeps?', 'A river. Check the hydrology layer.'],
  ['I go up and down the stairs without moving. What am I?', 'A staircase on a floor plan. Or contour lines on a hill.']
]

const COMPASS = [
  'All signs point north. That means yes.',
  'My needle says: absolutely.',
  'The legend is unclear. Ask again after a snack.',
  'Signs point to a scenic detour. Probably not.',
  'My compass is spinning. Try again.',
  'Yes, and it is on the way.',
  'Recalculating... that is a no.',
  'The map says yes, but check the scale.',
  'Outlook good, with a 500-foot buffer of caution.',
  'Not on this layer.'
]

const KNOCK: Array<[string, string]> = [
  ['Atlas', "Atlas-t, someone who appreciates a good map!"],
  ['Lettuce', 'Lettuce zoom in, I cannot see a thing!'],
  ['Scale', 'Scale-ebrate! You found the easter egg!'],
  ['Arrow', 'Arrow-nd and around we go, panning all day.'],
  ['Pixel', "Pixel me up at five, I'll be the paper map out front."]
]

const SONG = [
  '🎵 Oh I am a map, a folded-up chap,\n🎵 I live in your app with a pin in my lap,\n🎵 Just ask me a question, I\'ll find you the spot,\n🎵 And if it\'s not mapped... well, I\'ll learn it, why not! 🎵',
  '🎵 Zoom in, zoom out, pan all about,\n🎵 Turn on the layers, that\'s what it\'s about!\n🎵 Parcels and hydrants and sewers, oh my,\n🎵 I\'ll find them for you if you just say hi! 🎵',
  '🎵 Twinkle twinkle little pin,\n🎵 Where on Earth are you placed in?\n🎵 Up above the parcel line,\n🎵 Geocoded, looking fine! 🎵'
]

import { rand, pick, shuffle } from './random'

/** Hands out items without repeats until all are used, then starts over. */
class Deck<T> {
  private left: T[] = []
  constructor (private readonly all: T[]) {}
  get size (): number { return this.all.length }
  draw (): T {
    if (!this.left.length) this.left = shuffle(this.all)
    return this.left.pop() as T
  }
}

/** Where the app lives, for his lines: the organization ("the City"), the place ("Springfield") and local facts. */
export interface Place { org?: string, name?: string, website?: string, facts?: string[] }

export class Fun {
  private jokes = new Deck(JOKES)
  private facts = new Deck(FACTS)
  private localFacts = new Deck<string>([])
  private localKey = ''
  place: Place = {}

  /** The app's own place: local facts join the deck, and lines that name the town use its name. */
  setPlace (place: Place | undefined): void {
    this.place = place || {}
    const facts = (place?.facts || []).map(f => f.trim()).filter(Boolean)
    const key = facts.join('\n')
    if (key !== this.localKey) { this.localKey = key; this.localFacts = new Deck(facts) }
  }
  private riddles = new Deck(RIDDLES)
  private knocks = new Deck(KNOCK)
  private seasonJokes: string[] = []
  private seasonKey = ''
  /** A knock-knock joke or riddle in progress. */
  private stage: { kind: 'theirKnock' | 'theirWho' | 'myWho' | 'myPunch' | 'riddle', name?: string, punch?: string, at: number } | null = null

  /** A reply when the text is one of the easter eggs, else null. */
  reply (raw: string): FunReply | null {
    const t = raw.trim().toLowerCase().replace(/[!?.,]+$/g, '').replace(/\s+/g, ' ')
    const st = this.stage && Date.now() - this.stage.at < 120000 ? this.stage : null
    this.stage = null

    // Knock-knock, them telling it.
    if (st?.kind === 'theirKnock') { this.stage = { kind: 'theirWho', name: raw.trim().replace(/[!?.]+$/, ''), at: Date.now() }; return { text: `${this.stage.name} who?`, mood: 'listen' } }
    if (st?.kind === 'theirWho') return { text: pick(['😂 Ha! Good one. I\'m telling that to the compass.', '🤣 Oh, that got me right in the legend!', '😆 Okay, that was great. Ten out of ten pins.']), mood: 'celebrate' }
    // Knock-knock, Mappy telling it.
    if (st?.kind === 'myWho' && /who'?s there|who is there/.test(t)) { this.stage = { kind: 'myPunch', name: st.name, punch: st.punch, at: Date.now() }; return { text: `${st.name}.`, mood: 'talk' } }
    if (st?.kind === 'myPunch' && /\bwho\b/.test(t)) return { text: st.punch!, mood: 'celebrate', suggest: ['Another joke', 'Tell me a fun fact'] }
    // A riddle guess, unless it is plainly a command ("turn on parcels" still turns on parcels).
    if (st?.kind === 'riddle' && parseIntent(raw).name === 'ask' && !parseAnalysis(raw)) {
      if (/give up|i don'?t know|idk|no idea|tell me|what is it|answer/.test(t) || t.split(' ').length <= 5) return { text: `${/give up|don'?t know|idk|no idea|tell me|answer/.test(t) ? 'The answer: ' : 'Nice guess! The answer: '}${st.punch}`, mood: 'pleased', suggest: ['Another riddle', 'Tell me a joke'] }
    }

    if (/^knock[ ,-]*knock$/.test(t)) { this.stage = { kind: 'theirKnock', at: Date.now() }; return { text: "Who's there?", mood: 'listen' } }
    if (/^(?:tell me )?(?:a )?knock[ ,-]*knock joke$/.test(t)) { const [name, punch] = this.knocks.draw(); this.stage = { kind: 'myWho', name, punch, at: Date.now() }; return { text: 'Knock knock!', mood: 'excited' } }
    if (/^(?:tell me |give me )?(?:another|a|one more)?\s*(?:joke|pun)s?$|^(?:make me laugh|say something funny|another one|tell me a joke)$/.test(t)) {
      // This time of year's jokes come up about a third of the time.
      const extra = season().jokes
      // Each seasonal joke once per season, mixed in among the regular ones.
      if (extra.length && this.seasonKey !== extra[0]) { this.seasonKey = extra[0]; this.seasonJokes = shuffle(extra) }
      const text = this.seasonJokes.length && rand() < 0.34 ? this.seasonJokes.pop() as string : this.jokes.draw()
      return { text, mood: 'celebrate', suggest: ['Another joke', 'Tell me a knock knock joke'] }
    }
    if (/^(?:what(?:'s| is) (?:today|the occasion|special about today)|any holidays?|is it a holiday)$/.test(t)) { const s = season(); return { text: s.greeting || 'Just a regular great day for mapping. 🗺️', mood: s.mood || 'happy' } }
    // His outfit: "what are you wearing", "why the pi symbol", "what's with the pumpkin", "is that a taco on your head", "nice hat".
    // The Clippy pack on request: "get artsy", "get techy", "get wizardy", "paper airplane", "ride your bike", "do a trick".
    for (const [re, act, line] of ACT_ASKS) if (re.test(t)) return { text: line, mood: act, suggest: ['Do a trick', 'Get wizardy', 'Tell me a joke'] }
    if (/^(?:what tricks (?:can|do) you (?:do|know)|(?:show me|what are) your tricks|what (?:fun|games|easter eggs) (?:can|do) you (?:do|have|know)|do you know any tricks|can you do tricks|tricks)$/.test(t)) {
      return { text: 'A few: **get artsy**, **get techy**, **get wizardy**, **paper airplane**, **ride your bike**, **do a trick**, **dance**, **do a barrel roll**, **magic compass**, **flip a coin**, **roll a die**, **rock paper scissors**, **tell me a joke**, **knock knock**, **a riddle**, **fun fact**, **what\'s today**, and ask me **what are you wearing**. Click me six times fast, or try the Konami code.', mood: 'excited', suggest: ['Get wizardy', 'Paper airplane', 'Tell me a joke'] }
    }
    if (outfitAsk(t)) {
      const s = season()
      if (!s.hat) return { text: 'Just my regular folds today. I have an outfit for about 80 days of the year, so check back. 🗺️', mood: 'happy' }
      const thanks = /\b(?:nice|love|cool|cute|great|awesome)\b|\bi like\b/.test(t) ? pick(['Thank you! ', 'Aw, thanks! ', 'Why, thank you! ']) : ''
      const intro = s.greeting.toLowerCase().includes((s.name || '').toLowerCase().replace(/ (?:week|season)$/, '')) ? '' : `It's ${s.name}! `
      return { text: `${thanks}${intro}${s.greeting} I dressed for it: ${lowerFirst(WEAR[s.hat] || 'the whole outfit.')}`.trim(), mood: s.mood || 'pleased', suggest: ['What\'s today?', 'Tell me a joke'] }
    }
    if (/^(?:how are you(?: doing| today| feeling)?|how(?:'s| is) it going|how do you feel|you ok|are you ok)$/.test(t)) {
      const f = dayFeel()
      const s = season()
      return { text: `${pick(['Doing great, thanks for asking!', 'Pretty good! All my layers are loaded.', 'Feeling folded and fabulous.', 'Good! Nobody has spilled coffee on me yet today.'])} ${f.line || (s.greeting ? s.greeting : 'How about you?')}`.trim(), mood: f.mood || s.mood || 'happy', suggest: ['Tell me a joke', 'What\'s today?'] }
    }
    if (/^(?:tell me |give me )?(?:a |another )?riddle$/.test(t)) { const [q, a] = this.riddles.draw(); this.stage = { kind: 'riddle', punch: a, at: Date.now() }; return { text: `${q}\n\n(Take a guess, or say "I give up".)`, mood: 'think' } }
    if (/^(?:(?:tell me |give me |say |share )?(?:a |another |one more |some )?(?:fun |random |cool |interesting |map |local |quick )?facts?(?: please)?|another fact|tell me something (?:cool|interesting|fun)|did you know|trivia|(?:tell me |give me )?(?:a |some )?(?:fun |local )?trivia)$/.test(t)) {
      // "local fact" wants one about this place, when the app has any.
      if (/\blocal\b/.test(t) && this.localFacts.size) return { text: `📍 ${this.localFacts.draw()}`, mood: 'pleased', suggest: ['Another fact', 'Tell me a joke'] }
      // Local facts (from settings) come up about half the time when the app has them.
      const local = this.localFacts.size && rand() < 0.5
      return { text: `${local ? '📍' : '🗺️'} ${local ? this.localFacts.draw() : this.facts.draw()}`, mood: 'pleased', suggest: ['Another fact', 'Tell me a joke'] }
    }

    if (/^(?:do a |do the |let'?s )?(?:dance|boogie|groove|bust a move|show me your moves)/.test(t)) return { text: pick(['💃 Watch these folds go!', '🕺 The Map Shuffle! Patent pending.', '💃 Left fold, right fold, crinkle and spin!']), mood: 'dance' }
    if (/^(?:do a )?(?:barrel roll|flip|backflip|cartwheel|spin)$|^spin around$/.test(t)) return { text: pick(['Wheee! 🌀', 'Did you see that? Nailed the landing.', 'Ta-da! Still perfectly folded. Mostly.']), mood: 'roll' }
    if (/^(?:sing|sing (?:me )?a song|sing something|song)$/.test(t)) return { text: pick(SONG), mood: 'dance' }
    if (/^(?:party|party mode|let'?s party|celebrate|confetti)$/.test(t)) return { text: '🎉 PARTY MODE! Everybody grab a legend!', mood: 'party', effect: 'party' }
    if (/^(?:take me to |go to |show me |where is )?null island$/.test(t)) return { text: 'Welcome to Null Island 🏝️ at 0°, 0°! Population: every address that ever failed to geocode. Lovely this time of year.', mood: 'excited', effect: 'nullIsland', suggest: ['Take me home'] }
    if (/^(?:magic (?:8|eight)[ -]?ball|magic compass|ask the (?:magic )?compass)\b/.test(t)) return { text: `🧭 ${pick(COMPASS)}`, mood: 'think' }
    if (/^(?:flip a coin|coin flip|heads or tails)$/.test(t)) return { text: rand() < 0.5 ? '🪙 Heads!' : '🪙 Tails!', mood: 'excited' }
    const dice = t.match(/^roll (?:a |the )?(?:(\d+)[- ]sided )?(?:die|dice|d(\d+))$/)
    if (dice) { const sides = Math.max(2, Math.min(100, Number(dice[1] || dice[2]) || 6)); return { text: `🎲 You rolled a **${1 + Math.floor(rand() * sides)}**${sides !== 6 ? ` (d${sides})` : ''}.`, mood: 'excited' } }
    const rps = t.match(/^(?:(?:let'?s )?play )?(?:rock paper scissors[ ,:]*)?(rock|paper|scissors)$/)
    if (rps || /^(?:play )?rock paper scissors$/.test(t)) {
      if (!rps) return { text: 'Ready! Say rock, paper or scissors.', mood: 'excited' }
      const mine = pick(['rock', 'paper', 'scissors'])
      const beats: { [k: string]: string } = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
      const result = mine === rps[1] ? "It's a tie!" : beats[rps[1]] === mine ? 'You win! 🏆' : 'I win! (I am made of paper, it is my whole thing.)'
      return { text: `You: ${rps[1]}. Me: ${mine}. ${result}`, mood: result.startsWith('You win') ? 'pleased' : 'celebrate', suggest: ['rock', 'paper', 'scissors'] }
    }
    if (/^(?:where'?s waldo|where is waldo|find waldo)$/.test(t)) return { text: "I checked every layer. He's not on any of them. Suspicious. 🔍", mood: 'search' }
    if (/^what(?:'s| is) your favou?rite (?:map )?projection$/.test(t)) return { text: "Web Mercator, but don't tell Greenland. It's sensitive about its size.", mood: 'pleased' }
    if (/^what(?:'s| is) your favou?rite colou?r$/.test(t)) return { text: 'Parcel-boundary orange. Or highway red. Or river blue. I am a map, I love all the colors.', mood: 'happy' }
    if (/^(?:what(?:'s| is) your favou?rite (?:food|snack)|are you hungry|what do you eat)$/.test(t)) return { text: 'Tacos. Easy to fold, just like me. 🌮', mood: 'happy' }
    if (/^(?:how old are you|what(?:'s| is) your age|when were you born)$/.test(t)) return { text: "Old enough to remember paper road atlases, young enough to run in your browser.", mood: 'happy' }
    if (/^(?:are you (?:real|alive|human|a robot)|are you an? ai)$/.test(t)) return { text: "I'm a real map at heart! No big AI brain here, just a lot of careful reading of this app and a very good sense of direction.", mood: 'wave' }
    if (/^(?:boo|surprise)$/.test(t)) return { text: 'AAH! 😱 You scared the legend right off me!', mood: 'attention' }
    if (/^(?:tickle|tickle tickle|pet mappy|pat mappy|boop|boop mappy|pet|pat)$/.test(t)) return { text: pick(['Hehehe! Stop, I\'ll crease! 😆', '*happy crinkling noises*', 'Boop received. Morale at 100%.']), mood: /boop|pet|pat/.test(t) ? 'love' : 'excited' }
    if (/^(?:i'?m bored|i am bored|entertain me|i need a break|break time)$/.test(t)) return { text: 'I got you. Pick one!', mood: 'excited', suggest: ['Tell me a joke', 'Tell me a riddle', 'Do a dance', 'Fun fact'] }
    if (/^(?:good night|goodnight|nighty night)$/.test(t)) return { text: 'Good night! Sweet dreams of perfectly aligned layers. 🌙', mood: 'sleep' }
    if (/^(?:i'?m (?:sad|tired|stressed)|bad day|rough day)$/.test(t)) return { text: "Aww, sending you a big folded hug. 🤗 You're doing great, and I'm right here if you need anything found.", mood: 'love', suggest: ['Tell me a joke', 'Fun fact'] }
    if (/^(?:take me home|go home)$/.test(t)) return null
    if (/^(?:42|what is the meaning of life|meaning of life)$/.test(t)) return { text: 'According to my calculations: zoom level 42 does not exist, but tacos do. 🌮', mood: 'think' }
    if (/^(?:hello world)$/.test(t)) return { text: 'Hello, World! 🌍 (All of it. I have the extent.)', mood: 'wave' }
    if (/^(?:abracadabra|hocus pocus|magic)$/.test(t)) return { text: '✨ Poof! ...I am still a map. The magic is all in the layers.', mood: 'roll' }
    return null
  }
}

export type Hat =
  // the year's big days
  'party' | 'beanie' | 'valentine' | 'pi' | 'flower' | 'leaf' | 'fireworks' | 'shades' | 'scarf' | 'pumpkin' | 'gisday' | 'autumn' | 'snowflake' |
  // winter
  'bird' | 'plant' | 'tophat' | 'penguin' | 'squirrel' | 'ribbon' | 'puzzle' | 'cocoa' | 'groundhog' | 'pizza' | 'kindness' | 'pet' | 'frog' | 'polarbear' | 'mittens' |
  // spring
  'book' | 'fox' | 'seedling' | 'waterdrop' | 'pencil' | 'crayon' | 'kite' | 'umbrella' | 'rainbow' | 'sapling' | 'cape' | 'disco' | 'flowerbasket' | 'rocket' | 'firehelmet' | 'bikehelmet' | 'bee' | 'butterfly' | 'gradcap' | 'sunhat' |
  // summer
  'donut' | 'snorkel' | 'sun' | 'skateboard' | 'meteor' | 'lemonade' | 'chocolate' | 'emoji' | 'astronaut' | 'friendship' | 'sharkfin' | 'watermelon' | 'cat' | 'sleepmask' | 'shootingstar' | 'camera' | 'backpack' |
  // fall
  'apple' | 'code' | 'pirate' | 'coffee' | 'taco' | 'strawhat' | 'cornstalk' | 'sandwich' | 'beaker' | 'recycle' | 'lock' | 'cookie' | 'mountain' | 'lantern' | 'sparkler'

/** A mood he shows when the chat opens that day (party on New Year, dance on Dance Day). */
export type SeasonMood = 'party' | 'dance' | 'love' | 'excited' | 'celebrate' | 'happy'

export interface Season { hat: Hat | null, greeting: string, jokes: string[], mood?: SeasonMood, name?: string }

/*
  Time of year, kept welcoming for everyone who uses a city app: seasons, civic days and
  the light-hearted "day of" calendar (Pi Day, Earth Day, Pizza Day, Talk Like a Pirate
  Day, GIS Day...). Nothing religious, no flags worn as costume, no cultural costumes or
  caricatures, no brands, nothing political: friendly for everyone. One costume a day;
  the most specific entry wins, then the season.
*/

/** The nth weekday (0 = Sunday) of a month, 1-based n; n = -1 for the last one. */
function nthWeekday (y: number, month: number, weekday: number, n: number): Date {
  if (n < 0) {
    const last = new Date(y, month + 1, 0)
    return new Date(y, month, last.getDate() - ((last.getDay() - weekday + 7) % 7))
  }
  const first = new Date(y, month, 1)
  return new Date(y, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7)
}

const DAY = 86400000
function within (d: Date, from: Date, toInclusive: Date): boolean {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return t >= from.getTime() && t <= toInclusive.getTime()
}

type When = (d: Date, y: number, m: number, day: number) => boolean
interface Entry { when: When, hat: Hat, name: string, greeting: string, jokes?: string[], mood?: SeasonMood }

/** Month (1-12) and day, or a range of days in one month. */
const on = (m: number, from: number, to = from): When => (d, y, mm, day) => mm === m - 1 && day >= from && day <= to
/** The week around a computed date: `before` days ahead of it and `after` days past it. */
const around = (date: (y: number) => Date, before: number, after: number): When => (d, y) => { const c = date(y); return within(d, new Date(c.getTime() - before * DAY), new Date(c.getTime() + after * DAY)) }
const exactly = (date: (y: number) => Date): When => around(date, 0, 0)

/** Days of the year, most specific first. Seasons come last and fill in the rest. */
const CALENDAR: Entry[] = [
  // ---- computed dates
  { when: exactly(y => nthWeekday(y, 10, 3, 3)), hat: 'gisday', name: 'GIS Day', mood: 'party', greeting: 'Happy GIS Day! 🌍 Best day of the year, if you ask a map.', jokes: ['Why is GIS Day the best holiday? Everyone finally knows where the party is.', 'On GIS Day I wear my best projection. Today it is flattering.', 'GIS Day tip: celebrate responsibly. Snap to features, not to conclusions.'] },
  { when: around(y => nthWeekday(y, 10, 3, 3), 2, 2), hat: 'gisday', name: 'GIS Day week', greeting: 'It is GIS Day week! 🌍', jokes: ['Why is GIS Day the best holiday? Everyone finally knows where the party is.', 'On GIS Day I wear my best projection. Today it is flattering.'] },
  { when: exactly(y => nthWeekday(y, 10, 4, 4)), hat: 'autumn', name: 'Thanksgiving', mood: 'love', greeting: 'Happy Thanksgiving! 🍂 Thankful for good data and great people.', jokes: ['What did the map say after the big dinner? "I am stuffed, please fold me gently."', 'I am thankful for clean data, fast services and you. Mostly you.'] },
  { when: around(y => nthWeekday(y, 10, 4, 4), 4, 1), hat: 'autumn', name: 'Thanksgiving week', greeting: 'Happy Thanksgiving week! 🍂', jokes: ['What did the map say after the big dinner? "I am stuffed, please fold me gently."'] },
  { when: exactly(y => nthWeekday(y, 3, 5, -1)), hat: 'sapling', name: 'Arbor Day', greeting: 'Happy Arbor Day! 🌳 Plant a tree, then add it to the tree layer.', jokes: ['Why do trees love GIS? They finally get a canopy layer of their own.'] },
  { when: exactly(y => nthWeekday(y, 4, 5, 1)), hat: 'rocket', name: 'Space Day', mood: 'excited', greeting: 'Happy Space Day! 🚀 The only place my map has no coverage. Yet.', jokes: ['Why did the rocket love GIS? It finally found a projection with no distortion: space.', 'Space Day fact: Null Island is still easier to find than a parking spot.'] },
  { when: exactly(y => nthWeekday(y, 4, 5, 3)), hat: 'bikehelmet', name: 'Bike to Work Day', greeting: 'Happy Bike to Work Day! 🚲 Helmet on, bike lanes layer on.', jokes: ['Why do bikes love the trails layer? It is the only one that never has traffic.'] },
  { when: exactly(y => nthWeekday(y, 5, 5, 1)), hat: 'donut', name: 'Donut Day', mood: 'happy', greeting: 'Happy Donut Day! 🍩 The tastiest buffer there is.', jokes: ['What is a donut\'s favorite GIS tool? Buffer, with the inside erased.', 'A donut is just a ring polygon with sprinkles. Don\'t let anyone tell you otherwise.'] },
  // ---- January
  { when: on(1, 1, 3), hat: 'party', name: 'New Year', mood: 'party', greeting: 'Happy New Year! 🎉 New year, new layers.', jokes: ['My New Year\'s resolution: fewer null values.', 'New year, same projection. Some things are perfect.'] },
  { when: on(1, 5), hat: 'bird', name: 'Bird Day', greeting: 'Happy Bird Day! 🐦 My friend here has the best view of the map.', jokes: ['Why do birds love GIS? Everything is already in bird\'s-eye view.'] },
  { when: on(1, 10), hat: 'plant', name: 'Houseplant Appreciation Day', greeting: 'Happy Houseplant Appreciation Day! 🪴 Water the plants, then water the data.', jokes: ['My houseplant and my parcel layer have one thing in common: both grow when nobody is looking.'] },
  { when: on(1, 15), hat: 'tophat', name: 'Hat Day', greeting: 'Happy Hat Day! 🎩 I dressed up for the occasion.', jokes: ['Why did the map wear a top hat? To look sharp at the scale bar.'] },
  { when: on(1, 20), hat: 'penguin', name: 'Penguin Awareness Day', greeting: 'Happy Penguin Awareness Day! 🐧 My buddy here lives at the bottom of every world map.', jokes: ['Why do penguins love polar projections? Finally, somewhere they are at the center of attention.'] },
  { when: on(1, 21), hat: 'squirrel', name: 'Squirrel Appreciation Day', greeting: 'Happy Squirrel Appreciation Day! 🐿️ Nature\'s original point collector.', jokes: ['Why did the squirrel love GIS? It finally remembered where it buried everything.'] },
  { when: on(1, 24), hat: 'ribbon', name: 'Compliment Day', mood: 'love', greeting: 'Happy Compliment Day! 🏅 You have excellent taste in map assistants. Also, nice work today.', jokes: ['Compliment for the map: your projection is flawless and your legend is clear.'] },
  { when: on(1, 29), hat: 'puzzle', name: 'Puzzle Day', greeting: 'Happy Puzzle Day! 🧩 Every map is a puzzle where all the pieces are parcels.', jokes: ['Why are parcels the best puzzle? No two pieces are the same, and they still fit.'] },
  { when: on(1, 31), hat: 'cocoa', name: 'Hot Cocoa Day', greeting: 'Happy Hot Cocoa Day! ☕ Marshmallows are just tiny white polygons.', jokes: ['Why does cocoa love winter maps? Everything is cozy and the basemap is a blanket.'] },
  // ---- February
  { when: on(2, 2), hat: 'groundhog', name: 'Groundhog Day', greeting: 'Happy Groundhog Day! 🐾 Did he see his shadow? Check the shaded relief.', jokes: ['Why does the groundhog love GIS? Hillshade tells him about shadows in advance.'] },
  { when: on(2, 9), hat: 'pizza', name: 'Pizza Day', mood: 'happy', greeting: 'Happy Pizza Day! 🍕 The original pie chart.', jokes: ['Why is pizza the best GIS snack? Eight equal polygons, no overlaps.'] },
  { when: on(2, 10, 14), hat: 'valentine', name: 'Valentine\'s week', mood: 'love', greeting: 'Happy Valentine\'s Day week! 💛 Thanks for being a great map buddy.', jokes: ['I like you a latitude and a longitude.', 'You and good metadata: both make my day.'] },
  { when: on(2, 17), hat: 'kindness', name: 'Random Acts of Kindness Day', mood: 'love', greeting: 'Happy Random Acts of Kindness Day! 💛 Here is mine: you are doing great.', jokes: ['Kindness tip: label your layers so the next person does not have to guess.'] },
  { when: on(2, 20), hat: 'pet', name: 'Love Your Pet Day', greeting: 'Happy Love Your Pet Day! 🐶 Give them a scratch from me.', jokes: ['Why do dogs love GIS? Every walk is a GPS track.'] },
  { when: on(2, 27), hat: 'polarbear', name: 'Polar Bear Day', greeting: 'Happy Polar Bear Day! 🐻‍❄️ Big fan of the polar regions, like my friend here.', jokes: ['Why do polar bears love the Mercator projection? Greenland looks enormous.'] },
  { when: on(2, 29), hat: 'frog', name: 'Leap Day', mood: 'excited', greeting: 'Happy Leap Day! 🐸 A whole extra day of mapping.', jokes: ['Why do frogs love Leap Day? It is the one day the calendar hops too.'] },
  { when: on(2, 15, 29), hat: 'mittens', name: 'late winter', greeting: 'Hang in there, spring is on the way. 🧤', jokes: ['Why did the map wear mittens? Its corners were getting frostbite.'] },
  // ---- March
  { when: on(3, 2), hat: 'book', name: 'Reading Day', greeting: 'Happy Reading Day! 📖 Maps are books you read all at once.', jokes: ['My favorite book? The atlas. Great pictures, zero plot.'] },
  { when: on(3, 3), hat: 'fox', name: 'World Wildlife Day', greeting: 'Happy World Wildlife Day! 🦊 Say hi to my friend.', jokes: ['Why do foxes love GIS? Dens are just points with great attributes.'] },
  { when: on(3, 12), hat: 'seedling', name: 'Plant a Flower Day', greeting: 'Happy Plant a Flower Day! 🌱 Something is sprouting up top.', jokes: ['Why did the seedling love GIS? It wanted to grow into a polygon.'] },
  { when: on(3, 14), hat: 'pi', name: 'Pi Day', mood: 'celebrate', greeting: 'Happy Pi Day! 🥧 3.14159... and every one of those digits is a circle\'s best friend.', jokes: ['Why do maps love Pi Day? Every buffer is a circle.', 'My favorite number is pi. It goes on forever, like a good scroll through the layer list.'] },
  { when: on(3, 22), hat: 'waterdrop', name: 'World Water Day', greeting: 'Happy World Water Day! 💧 Every drop on this map is accounted for.', jokes: ['Why does water love GIS? Every river knows exactly where it is going: downhill, in the hydrology layer.'] },
  { when: on(3, 23), hat: 'pet', name: 'Puppy Day', mood: 'love', greeting: 'Happy Puppy Day! 🐶 Who\'s a good layer? You are.', jokes: ['Why do puppies love GIS? Every walk is a GPS track.'] },
  { when: on(3, 30), hat: 'pencil', name: 'Pencil Day', greeting: 'Happy Pencil Day! ✏️ The original editing tool.', jokes: ['Why do pencils love GIS? Every sketch has an undo.'] },
  { when: on(3, 31), hat: 'crayon', name: 'Crayon Day', greeting: 'Happy Crayon Day! 🖍️ Symbology, the fun way.', jokes: ['Why did the crayon love the legend? Finally, a box for every color.'] },
  { when: on(3, 1, 13), hat: 'kite', name: 'windy March', greeting: 'Windy out there! 🪁 Hold on to your map.', jokes: ['Why do kites love GIS? Great elevation data.'] },
  { when: on(3, 15, 19), hat: 'kite', name: 'windy March', greeting: 'Kite weather! 🪁', jokes: ['Why do kites love GIS? Great elevation data.'] },
  // ---- April
  { when: on(4, 1), hat: 'party', name: 'April Fools', mood: 'excited', greeting: 'Breaking news: the Earth is flat! ...April Fools. It is an oblate spheroid. 🌍', jokes: ['April Fools tip: the map is upside down. Just kidding. North is still up. Usually.'] },
  { when: on(4, 2, 9), hat: 'umbrella', name: 'spring showers', greeting: 'April showers! ☔ Good thing I am laminated.', jokes: ['Why does rain love GIS? It always finds the drainage layer.'] },
  { when: on(4, 11), hat: 'pet', name: 'Pet Day', greeting: 'Happy Pet Day! 🐶 Give them a scratch from me.', jokes: ['Why do dogs love GIS? Every walk is a GPS track.'] },
  { when: on(4, 20, 22), hat: 'leaf', name: 'Earth Day', mood: 'love', greeting: 'Happy Earth Day! 🌱 My favorite planet, and I have mapped all of it.', jokes: ['Why does the Earth love maps? We are the only ones who flatter it.', 'Earth Day tip: recycle your old shapefiles. Into a geodatabase.'] },
  { when: on(4, 23), hat: 'book', name: 'World Book Day', greeting: 'Happy World Book Day! 📖 Atlases count.', jokes: ['My favorite book? The atlas. Great pictures, zero plot.'] },
  { when: on(4, 24, 27), hat: 'rainbow', name: 'after the rain', greeting: 'Rain, then a rainbow. 🌈 The best kind of color ramp.', jokes: ['Why do rainbows love GIS? Seven classes, perfect color ramp.'] },
  { when: on(4, 28), hat: 'cape', name: 'Superhero Day', mood: 'excited', greeting: 'Happy Superhero Day! 🦸 My power: finding things. Also folding.', jokes: ['What is a map\'s superpower? Being in two projections at once.'] },
  { when: on(4, 29), hat: 'disco', name: 'Dance Day', mood: 'dance', greeting: 'Happy Dance Day! 🕺 Watch me do the projection shuffle.', jokes: ['What dance do maps do? The Mercator stretch.'] },
  // ---- May
  { when: on(5, 1), hat: 'flowerbasket', name: 'May Day', greeting: 'Happy May Day! 🌼 Flowers for everyone.', jokes: ['Why do flowers love May? Every bloom gets its own point.'] },
  { when: on(5, 4), hat: 'firehelmet', name: 'Firefighters\' Day', mood: 'celebrate', greeting: 'Happy Firefighters\' Day! 🚒 Thank you to everyone who runs toward trouble. Hydrant layer, at your service.', jokes: ['Why do firefighters love GIS? Every hydrant is right where the map says.'] },
  { when: on(5, 20), hat: 'bee', name: 'World Bee Day', greeting: 'Happy World Bee Day! 🐝 Bees were doing spatial analysis before it was cool.', jokes: ['Why do bees love GIS? Every flower is a point, and the waggle dance is a route.'] },
  { when: on(5, 22), hat: 'butterfly', name: 'Biodiversity Day', greeting: 'Happy Biodiversity Day! 🦋 So many species, so many layers.', jokes: ['Why do butterflies love GIS? Great migration routes.'] },
  { when: on(5, 25, 31), hat: 'gradcap', name: 'graduation season', mood: 'celebrate', greeting: 'Congratulations to all the graduates! 🎓', jokes: ['What did the map say at graduation? "I finally know where I am going."'] },
  { when: on(5, 2, 24), hat: 'sunhat', name: 'garden season', greeting: 'Garden season! 🌻 Dig in.', jokes: ['Why do gardeners love GIS? Every bed is a polygon with a planting date.'] },
  // ---- June
  { when: on(6, 5), hat: 'leaf', name: 'World Environment Day', greeting: 'Happy World Environment Day! 🌱', jokes: ['Earth tip: recycle your old shapefiles. Into a geodatabase.'] },
  { when: on(6, 8), hat: 'snorkel', name: 'World Oceans Day', greeting: 'Happy World Oceans Day! 🌊 Seventy percent of the map, and I love every drop.', jokes: ['Why do fish love GIS? Schools are just clusters.'] },
  { when: on(6, 21), hat: 'skateboard', name: 'Go Skateboarding Day', mood: 'excited', greeting: 'Happy Go Skateboarding Day! 🛹 Also the longest day of the year. More daylight for mapping.', jokes: ['Why do skateboards love GIS? Great ramps in the elevation layer.'] },
  { when: on(6, 20, 22), hat: 'sun', name: 'summer solstice', greeting: 'Happy summer solstice! ☀️ The longest day of the year.', jokes: ['Why does the sun love the solstice? Maximum coverage.'] },
  { when: on(6, 30), hat: 'meteor', name: 'Asteroid Day', greeting: 'Happy Asteroid Day! ☄️ Craters are the original points of interest.', jokes: ['Why do asteroids love GIS? Impact analysis.'] },
  { when: on(6, 1, 19), hat: 'lemonade', name: 'early summer', greeting: 'Summer is here. 🍋 Lemonade weather.', jokes: ['Why does lemonade love GIS? It is a point of refreshment.'] },
  // ---- July
  { when: on(7, 1, 5), hat: 'fireworks', name: 'Independence Day', mood: 'celebrate', greeting: 'Happy Independence Day! 🎆 Enjoy the fireworks safely.', jokes: ['Why did the firework love the map? Great coverage, no gaps.'] },
  { when: on(7, 7), hat: 'chocolate', name: 'Chocolate Day', mood: 'happy', greeting: 'Happy Chocolate Day! 🍫 Dark, milk, or a gradient of both.', jokes: ['Why does chocolate love GIS? Every bar is a perfect grid.'] },
  { when: on(7, 14), hat: 'sharkfin', name: 'Shark Awareness Day', greeting: 'Happy Shark Awareness Day! 🦈 Just a fin, nothing to worry about.', jokes: ['Why do sharks love GIS? Great tracking data.'] },
  { when: on(7, 17), hat: 'emoji', name: 'Emoji Day', mood: 'happy', greeting: 'Happy Emoji Day! 😀🗺️📍', jokes: ['What is a map\'s favorite emoji? 📍 Obviously.'] },
  { when: on(7, 20), hat: 'astronaut', name: 'Moon Day', mood: 'excited', greeting: 'Happy Moon Day! 🌙 One small step for a map...', jokes: ['Why did the astronaut love GIS? The Moon has great relief, and no traffic.'] },
  { when: on(7, 30), hat: 'friendship', name: 'Friendship Day', mood: 'love', greeting: 'Happy Friendship Day! 💛 Thanks for being my favorite person to find things with.', jokes: ['Friends are like layers: the best ones are always there when you need them.'] },
  // ---- August
  { when: on(8, 1), hat: 'watermelon', name: 'Watermelon Day', mood: 'happy', greeting: 'Happy Watermelon Day! 🍉 A slice of summer.', jokes: ['Why does watermelon love GIS? Seeds are just a point layer.'] },
  { when: on(8, 8), hat: 'cat', name: 'Cat Day', greeting: 'Happy Cat Day! 🐱 I sat in a box for the occasion.', jokes: ['Why do cats love GIS? They are always exactly where they should not be, and now it is mapped.'] },
  { when: on(8, 10), hat: 'sleepmask', name: 'Lazy Day', greeting: 'Happy Lazy Day. 😴 Take it easy. I will find things slowly.', jokes: ['Lazy Day tip: zoom to full extent and call it a day.'] },
  { when: on(8, 11, 13), hat: 'shootingstar', name: 'Perseid meteor shower', greeting: 'Perseid meteor shower this week! 🌠 Look up, away from the city lights.', jokes: ['Why do shooting stars love GIS? Every streak is a line feature.'] },
  { when: on(8, 19), hat: 'camera', name: 'Photography Day', greeting: 'Happy Photography Day! 📷 Say "basemap"!', jokes: ['Why do cameras love GIS? Every photo already has a location.'] },
  { when: on(8, 26), hat: 'pet', name: 'Dog Day', mood: 'love', greeting: 'Happy Dog Day! 🐶 Who\'s a good boy? This map.', jokes: ['Why do dogs love GIS? Every walk is a GPS track.'] },
  { when: on(8, 21, 31), hat: 'backpack', name: 'back to school', greeting: 'Back to school! 🎒 Pencils sharp, layers labeled.', jokes: ['Why do backpacks love GIS? Zipped compartments are just layers.'] },
  // ---- September
  { when: on(9, 13), hat: 'code', name: 'Programmers\' Day', greeting: 'Happy Programmers\' Day! 💻 Day 256 of the year. No bugs, only features.', jokes: ['Why do programmers love GIS? Finally, a feature that is not a bug.'] },
  { when: on(9, 19), hat: 'pirate', name: 'Talk Like a Pirate Day', mood: 'excited', greeting: 'Arrr! Happy Talk Like a Pirate Day! 🏴‍☠️ X marks the spot, and I have the coordinates.', jokes: ['Why do pirates love GIS? Every treasure map is finally georeferenced.', 'What is a pirate\'s favorite layer? The arrrrchive.'] },
  { when: on(9, 22, 23), hat: 'autumn', name: 'first day of fall', greeting: 'First day of fall! 🍂 The leaves layer is changing color.', jokes: ['Why do maps love fall? Every layer changes color.'] },
  { when: on(9, 26), hat: 'apple', name: 'Johnny Appleseed Day', greeting: 'Happy Johnny Appleseed Day! 🍎 One tree at a time, like a good point layer.', jokes: ['Why do apples love GIS? Orchards are the tidiest point layer around.'] },
  { when: on(9, 29), hat: 'coffee', name: 'Coffee Day', mood: 'excited', greeting: 'Happy Coffee Day! ☕ Fully caffeinated and ready to find things.', jokes: ['Why does coffee love GIS? It is always in the hot spot analysis.'] },
  { when: on(9, 1, 12), hat: 'apple', name: 'back to school', greeting: 'New school year! 🍎 An apple for every teacher.', jokes: ['Why do apples love GIS? Orchards are the tidiest point layer around.'] },
  // ---- October
  { when: on(10, 4), hat: 'taco', name: 'Taco Day', mood: 'party', greeting: 'Happy Taco Day! 🌮 The greatest fold of all. Eat abundantly.', jokes: ['Why do tacos love GIS? Great shell, perfectly folded, everything in layers.', 'A taco is just a map of flavor, folded once.'] },
  { when: on(10, 5), hat: 'apple', name: 'World Teachers\' Day', mood: 'love', greeting: 'Happy World Teachers\' Day! 🍎 Thank you to everyone who taught us where things are.', jokes: ['Why do teachers love GIS? Every question has a where.'] },
  { when: on(10, 12), hat: 'strawhat', name: 'Farmers\' Day', greeting: 'Happy Farmers\' Day! 🌾 Thank you to everyone growing the food.', jokes: ['Why do farmers love GIS? Every field is a polygon with a yield.'] },
  { when: on(10, 16), hat: 'book', name: 'Dictionary Day', greeting: 'Happy Dictionary Day! 📖 Ask me what any map word means.', jokes: ['What is a dictionary\'s favorite layer? The one with all the definitions in the metadata.'] },
  { when: on(10, 21, 23), hat: 'cornstalk', name: 'harvest', greeting: 'Harvest time! 🌽', jokes: ['Why does corn love GIS? Rows are just a perfect grid.'] },
  { when: on(10, 24, 31), hat: 'pumpkin', name: 'pumpkin season', mood: 'excited', greeting: 'Spooky season! 🎃 Boo! Did I scare the legend off you?', jokes: ['What is a ghost\'s favorite map? A haunt-ography.', 'Why did the skeleton skip the GIS meeting? It had no body to digitize with.', 'What do you call a spooky layer? A boo-ffer.'] },
  // ---- November
  { when: on(11, 3), hat: 'sandwich', name: 'Sandwich Day', mood: 'happy', greeting: 'Happy Sandwich Day! 🥪 Layers, in the tastiest order.', jokes: ['Why is a sandwich the best GIS lunch? Perfect layer order, bread on the bottom.'] },
  { when: on(11, 8), hat: 'beaker', name: 'STEM Day', greeting: 'Happy STEM Day! 🔬 Science, tech, engineering, maps.', jokes: ['Why do scientists love GIS? Every hypothesis has a where.'] },
  { when: on(11, 13), hat: 'kindness', name: 'World Kindness Day', mood: 'love', greeting: 'Happy World Kindness Day! 💛 You are doing great, and I mean it.', jokes: ['Kindness tip: label your layers so the next person does not have to guess.'] },
  { when: on(11, 15), hat: 'recycle', name: 'Recycling Day', greeting: 'Happy Recycling Day! ♻️ Old shapefiles belong in a geodatabase.', jokes: ['Why does recycling love GIS? Every bin has a route.'] },
  { when: on(11, 30), hat: 'lock', name: 'Computer Security Day', greeting: 'Happy Computer Security Day! 🔒 Strong passwords, locked layers.', jokes: ['Why do maps love security? Nobody edits the parcels without a key.'] },
  // ---- December
  { when: on(12, 4), hat: 'cookie', name: 'Cookie Day', mood: 'happy', greeting: 'Happy Cookie Day! 🍪 Chips are just a point layer.', jokes: ['Why do cookies love GIS? Every chip is a point of interest.'] },
  { when: on(12, 11), hat: 'mountain', name: 'Mountain Day', greeting: 'Happy Mountain Day! ⛰️ Hillshade looks great today.', jokes: ['Why do mountains love GIS? Finally, someone appreciates their contour lines.'] },
  { when: on(12, 21), hat: 'lantern', name: 'winter solstice', greeting: 'Happy winter solstice! 🏮 The longest night, so I brought a light.', jokes: ['Why does the solstice love GIS? Shortest day, longest shadows in the hillshade.'] },
  { when: on(12, 27, 31), hat: 'sparkler', name: 'year end', mood: 'celebrate', greeting: 'Almost a new year! ✨ Thanks for a great one.', jokes: ['Year-end tip: archive the old layers, keep the good people.'] },
  // ---- seasons
  { when: (d, y, m, day) => m === 0 || (m === 1 && day < 7), hat: 'beanie', name: 'winter', greeting: 'Brr! Stay warm out there. ❄️', jokes: ['Why did the map wear a beanie? It lost its heat to the polar regions.', 'Snow days are great. Everything is the same color, so I match the basemap.'] },
  { when: (d, y, m, day) => (m === 2 && day >= 20) || m === 3 || (m === 4 && day <= 15), hat: 'flower', name: 'spring', greeting: 'Happy spring! 🌷 Everything is growing, including the parcel layer.', jokes: ['Why do maps love spring? Every layer turns green.', 'Spring cleaning tip: delete the layers named "test_final_v2".'] },
  { when: (d, y, m, day) => (m === 5 && day >= 20) || m === 6 || (m === 7 && day <= 20), hat: 'shades', name: 'summer', greeting: 'Summer mode on. 😎 Hot out there, stay hydrated.', jokes: ['Why did the map wear sunglasses? Too much bright basemap.', 'Summer here: the only layer hotter than the heat map is the actual heat.'] },
  { when: (d, y, m, day) => (m === 8 && day >= 22) || m === 9 || m === 10, hat: 'scarf', name: 'fall', greeting: 'Fall is here. 🍂 Perfect weather for field work.', jokes: ['Why do maps love fall? Every layer changes color.'] },
  { when: (d, y, m, day) => m === 11 && day <= 26, hat: 'snowflake', name: 'winter holidays', greeting: 'Happy holidays! ❄️ Wishing you a warm, restful season.', jokes: ['Why did the snowflake join the GIS team? Every one of them is a unique feature.', 'Why do maps love winter? Snow means a fresh, clean basemap.'] }
]

/** What Mappy wears and says this time of year: the most specific day first, then the season. */
export function season (d = new Date()): Season {
  const y = d.getFullYear(); const m = d.getMonth(); const day = d.getDate()
  const e = CALENDAR.find(x => x.when(d, y, m, day))
  return e ? { hat: e.hat, greeting: e.greeting, jokes: e.jokes || [], mood: e.mood, name: e.name } : { hat: null, greeting: '', jokes: [] }
}

/** Does the question ask about what he is wearing, by name or by naming a piece of today's outfit? */
export function outfitAsk (t: string, d = new Date()): boolean {
  if (/^(?:what are you wearing|why the (?:hat|outfit|costume)|what(?:'s| is) (?:on your head|in your hand|with the (?:hat|outfit|costume)|that on your head|that in your hand)|why are you (?:wearing|dressed)[^?]*|why (?:are you )?dressed (?:like|up)[^?]*|nice (?:hat|outfit|costume|look)|i (?:like|love) your (?:hat|outfit|costume|look)|cool (?:hat|outfit|costume))$/.test(t)) return true
  const s = season(d)
  if (!s.hat) return false
  // Words for today's outfit: the hat's name and the nouns in its description.
  const words = new Set<string>([s.hat, ...(WEAR[s.hat] || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w))])
  if (s.hat === 'pi') { words.add('pi'); words.add('π') }
  // "why the pumpkin", "what's with the taco", "is that a pi symbol", "nice globe", "I love your scarf": a piece of
  // the outfit, asked about the way you ask about someone's clothes. "What is a pumpkin" is a different question.
  const asking = /\b(?:why|is that|what(?:'s| is) with|what(?:'s| is) that|nice|cool|cute|love|like|your|where did you get)\b/.test(t)
  if (!asking) return false
  const mention = /\b(?:wearing|dressed|hat|outfit|costume|on your head|in your hand|holding|look)\b/.test(t)
  const named = Array.from(words).some(w => new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?:$|[^a-z])`).test(t))
  return (mention || named) && !/\b(?:layer|map|zoom|turn|show|find|where is|address|street|ave|road|parcel)\b/.test(t)
}

const STOP = new Set(['with', 'that', 'this', 'from', 'your', 'them', 'they', 'have', 'there', 'where', 'what', 'when', 'just', 'some', 'into', 'over', 'ones', 'thing', 'things', 'little', 'friend', 'friendly', 'edition', 'works', 'good', 'stuff', 'because', 'about', 'every', 'much', 'nothing', 'worry', 'corner', 'missing', 'round', 'number', 'strong', 'greatest', 'fold'])

function lowerFirst (s: string): string { return s ? s[0].toLowerCase() + s.slice(1) : s }

/** What each outfit is, in his words, for "what are you wearing". Unlisted ones get the day's name alone. */
const WEAR: { [hat: string]: string } = {
  party: 'Party hat, noisemaker, confetti. The works.', beanie: 'Beanie, scarf and mittens. It is cold out there.', snowflake: 'My snow beanie, with a few flakes for company.', valentine: 'Hearts, everywhere. Even the lake.', pi: 'A pi badge and a slice of pie. Irrational, delicious.', flower: 'A flower crown, with a few growing at my feet.', leaf: 'Leaves for the planet, and a leafy lake.', fireworks: 'Fireworks up top and a sparkler in hand. Safely.', shades: 'Sunglasses, a popsicle and a little sun. Summer.', scarf: 'A cozy scarf and a leaf I caught.', pumpkin: 'A pumpkin up top, two at my feet, and candy corn. Spooky season, friendly edition.', gisday: 'A globe on my head, a GIS badge and a little flag. My favorite day.', autumn: 'Fall leaves, blowing everywhere.',
  bird: 'A nest and a little bird friend on my hand.', plant: 'A houseplant up top and a watering can.', tophat: 'A top hat and a cane. Fancy.', penguin: 'A beanie, and my penguin friend came along.', squirrel: 'An acorn hat, and a squirrel who is keeping an eye on it.', ribbon: 'A gold ribbon, because you deserve a compliment too.', puzzle: 'Puzzle pieces. Every map is one.', cocoa: 'A cozy beanie and a mug of hot cocoa with marshmallows.', groundhog: 'A beanie, and my groundhog friend checking for shadows.', pizza: 'A slice up top and one in hand. No sharing.', kindness: 'A golden heart and a few flowers to give away.', pet: 'Paw prints up top, and a dog buddy.', frog: 'A frog on my head for the leap. Ribbit.', polarbear: 'A snow beanie, and my polar bear friend.', mittens: 'Mittens, a scarf and a warm beanie.',
  book: 'An open book on my head and one in hand.', fox: 'A leafy crown and a fox friend.', seedling: 'A seedling sprouting up top, and a few more at my feet.', waterdrop: 'A big water drop and a glass of water. Stay hydrated.', pencil: 'A pencil behind my ear, so to speak, and one in hand.', crayon: 'Crayons! Symbology, the fun way.', kite: 'A kite, catching the March wind.', umbrella: 'An umbrella and rain boots. April showers.', rainbow: 'A rainbow and a couple of clouds.', sapling: 'A little tree up top, a shovel in hand, and two saplings at my feet.', cape: 'A cape and a mask. My power is finding things.', disco: 'A disco ball. Watch me dance.', flowerbasket: 'A flower crown and a basket of flowers for everyone.', rocket: 'A space helmet and a rocket.', firehelmet: 'A fire helmet and a hydrant, for the people who run toward trouble.', bikehelmet: 'A bike helmet and a bike. Bike lanes layer on.', bee: 'A bee buzzing around my flower crown, and a jar of honey.', butterfly: 'A butterfly up top and a few flying around.', gradcap: 'A cap with a tassel and a diploma.', sunhat: 'A garden hat and a trowel.',
  donut: 'A donut up top and coffee in hand.', snorkel: 'A mask and snorkel, and a fish friend.', sun: 'A smiling sun, sunglasses and a popsicle.', skateboard: 'A helmet and a skateboard.', meteor: 'A meteor and a telescope.', lemonade: 'A lemon crown and a glass of lemonade.', chocolate: 'A bar of chocolate, unwrapped. A corner is missing.', emoji: 'A smiley up top. 😀', astronaut: 'A space helmet, a moon rock and a life-support pack.', friendship: 'Friendship bracelets, and hearts for you.', sharkfin: 'A shark fin and a fish friend. Nothing to worry about.', watermelon: 'A slice of watermelon and sunglasses.', cat: 'Cat ears, whiskers, a box and a cat friend.', sleepmask: 'A sleep mask, a nightcap and a pillow. Lazy Day.', shootingstar: 'A shooting star and a telescope, for the meteor shower.', camera: 'A camera and a tripod.', backpack: 'A backpack, a pencil and an apple for the teacher.',
  apple: 'An apple on my head and a notebook.', code: 'A tiny screen, a mug of coffee and some code. 256 is a round number.', pirate: 'A pirate hat, a treasure map and a parrot friend. Arrr.', coffee: 'A beanie and a mug of coffee. The good stuff.', taco: 'A taco on my head and one in hand. The greatest fold.', strawhat: 'A straw hat and a stalk of wheat.', cornstalk: 'An ear of corn and two cornstalks.', sandwich: 'A sandwich up top. Perfect layer order.', beaker: 'A beaker of something green and a test tube.', recycle: 'Recycling arrows and a blue bin.', lock: 'A padlock and a key. Strong passwords.', cookie: 'A chocolate chip cookie and a glass of milk.', mountain: 'Mountains, with snow on top, and a walking stick.', lantern: 'A lantern for the longest night, and a warm beanie.', sparkler: 'A party hat and a sparkler. Almost a new year.'
}

/** Every costume there is, for the builder's preview and the tests. */
export function allHats (): Hat[] { return Array.from(new Set(CALENDAR.map(e => e.hat))) }

/**
 * How he feels right now, by the clock: a line for the greeting and a mood, so Monday morning
 * and Friday afternoon do not feel the same. Empty at ordinary hours.
 */
export function dayFeel (d = new Date()): { line: string, mood?: SeasonMood } {
  const h = d.getHours(); const wd = d.getDay()
  if (wd === 1 && h < 10) return { line: 'Monday morning. ☕ We\'ve got this.' }
  if (wd === 5 && h >= 15) return { line: 'Friday afternoon! 🎉 Almost there.', mood: 'happy' }
  if (h >= 5 && h < 8) return { line: 'Early bird! 🌅 Coffee is on me. Figuratively.' }
  if (h >= 11 && h < 13) return { line: 'Lunchtime-ish. 🌮 Tacos are always the answer.' }
  if (h >= 15 && h < 16) return { line: 'Mid-afternoon stretch. 🙆 Shoulders down, map up.' }
  if (h >= 18 && h < 22) return { line: 'Working late? 🌙 I am happy to keep you company.' }
  if (h >= 22 || h < 5) return { line: 'Burning the midnight oil! 🦉 I will be quick so you can rest.' }
  return { line: '' }
}

/** Seasonal hat for Mappy, from the date. */
export function seasonalHat (d = new Date()): Hat | null { return season(d).hat }
