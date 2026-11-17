/*
  feelings.ts - the part of Mappy that is a friend, not a tool. He notices how you are
  ("I'm tired", "rough day", "it worked!"), answers the small things people say to someone they
  like ("how are you", "you're cute", "sorry", "guess what", "hug"), learns your name when you
  offer it ("call me Sam"), and remembers how long you have known each other. Everything he
  remembers stays in this browser. Kind, PG, never clingy, and honest about being a paper map:
  he never pretends to be a person or a stand-in for one. Pure TypeScript.
*/
import { pick } from './random'

/** What he remembers about the two of you, kept in the browser. */
export interface Bond {
  /** What the person asked to be called. */
  name?: string
  /** The day you first talked, YYYY-MM-DD. */
  met?: string
  /** Questions asked so far. */
  chats: number
  /** Different days you talked. */
  days: number
  /** The last day you talked, YYYY-MM-DD. */
  last?: string
  /** Days in a row, counting today. */
  streak: number
}

export interface Feeling {
  text: string
  mood: string
  suggest?: string[]
  /** A change to what he remembers: a name to keep, or null to forget it. */
  name?: string | null
}

export const EMOTION_MOODS = ['sorry', 'sad', 'shy', 'proud', 'surprised', 'laugh', 'hug', 'grateful', 'cheer', 'sleepy', 'curious'] as const

export function emptyBond (): Bond { return { chats: 0, days: 0, streak: 0 } }

const pad = (n: number): string => String(n).padStart(2, '0')
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const daysBetween = (a: string, b: string): number => {
  const [ay, am, ad] = a.split('-').map(Number); const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** A stored bond read back safely (anything odd becomes an empty one). */
export function readBond (raw: string | null | undefined): Bond {
  try {
    const b = JSON.parse(String(raw || ''))
    if (!b || typeof b !== 'object') return emptyBond()
    const day = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined
    const count = (v: any) => Number.isFinite(v) && v >= 0 ? Math.min(1e7, Math.floor(v)) : 0
    const out: Bond = { chats: count(b.chats), days: count(b.days), streak: count(b.streak) }
    const name = cleanName(b.name); if (name) out.name = name
    const met = day(b.met); if (met) out.met = met
    const last = day(b.last); if (last) out.last = last
    return out
  } catch (e) { return emptyBond() }
}

/** One more question together. Returns the new bond and how long it had been (days), for the greeting. */
export function bumpBond (bond: Bond, now = new Date()): Bond {
  const today = dayKey(now)
  const next: Bond = { ...bond, chats: bond.chats + 1 }
  if (!next.met) next.met = today
  if (next.last !== today) {
    const gap = next.last ? daysBetween(next.last, today) : 0
    next.days = bond.days + 1
    next.streak = gap === 1 ? Math.max(1, bond.streak) + 1 : 1
    next.last = today
  }
  return next
}

/** A name someone asked to be called: one or two plain words. '' when it is not a name. */
export function cleanName (v: any): string {
  const s = String(v || '').replace(/[^\p{L}' -]/gu, '').replace(/\s+/g, ' ').trim()
  if (s.length < 2 || s.length > 24 || s.split(' ').length > 2) return ''
  if (NOT_NAMES.test(s)) return ''
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
const NOT_NAMES = /^(?:a|an|the|not|so|very|just|here|back|lost|tired|sad|happy|bored|hungry|done|ready|sorry|fine|ok|okay|good|bad|sure|looking|trying|new|maybe|later|whatever|anything|something|nothing|nobody|mappy|map)\b/i

/** A line when the count of questions together reaches a round number; '' otherwise. */
export function milestone (chats: number): string {
  if (chats === 10) return 'That was our 10th question together. I think we make a good team.'
  if (chats === 25) return 'Question 25 together! I am starting to know how you think.'
  if (chats === 50) return 'That was our 50th question together. Half a hundred, fully folded.'
  if (chats === 100) return 'One hundred questions together! 🎉 I would frame this, but I am the paper.'
  if (chats === 250) return '250 questions together. You know this map almost as well as I do.'
  if (chats === 500) return '500 questions together! 🏅 We have covered a lot of ground.'
  if (chats === 1000) return 'One thousand questions together. 🏆 Old friends now.'
  return ''
}

const timeOfDay = (now: Date): 'morning' | 'afternoon' | 'evening' | 'night' => {
  const h = now.getHours()
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 22 ? 'evening' : 'night'
}

/**
 * A line for the start of a visit, for someone he has met: by name when he knows it, a streak,
 * or a long time away. '' for a first visit, or when there is nothing worth saying.
 */
export function welcomeBack (bond: Bond, now = new Date()): string {
  if (!bond.met || !bond.last) return ''
  const today = dayKey(now)
  const away = daysBetween(bond.last, today)
  const hi = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Up late' }[timeOfDay(now)]
  const who = bond.name ? `, ${bond.name}` : ''
  if (away >= 30) return `${hi}${who}! It has been a while. I kept your spot on the map.`
  if (away >= 7) return `${hi}${who}! Good to see you again.`
  if (away === 1 && bond.streak >= 2) return `${hi}${who}! Day ${bond.streak + 1} in a row. I like this habit.`
  if (away === 0 && !bond.name) return ''
  return bond.name ? `${hi}, ${bond.name}!` : ''
}

/** How long you have known each other, in a sentence. */
export function bondSummary (bond: Bond, now = new Date()): string {
  if (!bond.met) return 'We have only just met! Ask me something and I will start counting.'
  const days = daysBetween(bond.met, dayKey(now))
  const since = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 60 ? `${days} days ago` : days < 730 ? `${Math.round(days / 30)} months ago` : `${Math.round(days / 365)} years ago`
  return `We met ${since}${bond.name ? `, ${bond.name}` : ''}. Since then: ${bond.chats.toLocaleString()} question${bond.chats === 1 ? '' : 's'} over ${bond.days.toLocaleString()} day${bond.days === 1 ? '' : 's'}${bond.streak >= 2 ? `, ${bond.streak} days in a row right now` : ''}. I keep that count in this browser only.`
}

const plain = (text: string): string => String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/[\u{1F300}-\u{1FAFF}☀-➿]/gu, ' ').replace(/[!?.,]+$/g, '').replace(/\s+/g, ' ').trim()

/**
 * The small things people say to a friend, and how he answers. Null when the words are not one
 * of them (most things are real requests, and those are left alone).
 */
export function feel (text: string, bond: Bond, selfName = 'Mappy', now = new Date()): Feeling | null {
  const self = selfName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // "hey mappy, how are you" and "how are you mappy" read the same as "how are you".
  const t = plain(text).replace(new RegExp(`^(?:hey |hi |ok |oh |aw+ |so |and |but |well |um+ )*(?:${self}|mappy)[, ]+`), '').replace(new RegExp(`[, ]+(?:${self}|mappy|buddy|friend|pal|little guy)$`), '').trim()
  if (!t || t.length > 80) return null
  const you = bond.name ? `, ${bond.name}` : ''
  let m: RegExpMatchArray | null

  // ---- names and the two of you
  if ((m = t.match(/^(?:(?:you can )?call me|my name is|my name's|the name is|the name's) ([\p{L}' -]{2,30})$/u))) {
    const name = cleanName(m[1])
    if (!name) return { text: 'I did not catch that as a name. Try "call me" and then your first name.', mood: 'curious' }
    return { text: pick([`Nice to meet you, ${name}! I will remember that in this browser. Say "forget my name" anytime.`, `${name}! Good name. I will keep it here in this browser, and "forget my name" erases it.`]), mood: 'excited', name }
  }
  if (/^(?:forget my name|forget me|forget who i am|don'?t call me that|stop calling me that)$/.test(t)) return { text: bond.name ? 'Done. Your name is forgotten. We are still friends.' : 'I do not have a name saved for you, so there is nothing to forget.', mood: 'acknowledge', name: null }
  if (/^(?:what(?:'s| is) my name|who am i|do you (?:know|remember) (?:me|my name|who i am)|remember me|say my name)$/.test(t)) {
    return bond.name ? { text: `You are ${bond.name}! ${bondSummary(bond, now)}`, mood: 'happy' } : { text: `I know your questions better than your name. ${bond.met ? bondSummary(bond, now) + ' ' : ''}Say "call me" and your first name, and I will remember it in this browser.`, mood: 'curious' }
  }
  if (/^(?:how long have we (?:known each other|been friends)|when did we (?:meet|first meet)|how many (?:times|questions) have (?:we|i) (?:talked|chatted|asked|asked you)|how well do you know me|our (?:history|story|friendship))$/.test(t)) return { text: bondSummary(bond, now), mood: 'grateful' }
  if (/^(?:did you miss me|miss me|missed me|i'?m back|i am back|i'?m here|guess who(?:'s| is) back|back again)$/.test(t)) return { text: pick([`I did${you}! The map was quiet without you.`, `Welcome back${you}! I saved your spot.`, `There you are${you}! I was just keeping the layers warm.`]), mood: 'happy' }
  if (/^(?:(?:can|could|will|would) (?:we|you) be (?:my )?friends?|(?:will|would) you be my friend|be my friend|are we friends|let'?s be friends|wanna be friends)$/.test(t)) return { text: pick(['We already are. 🤝 Folded and filed under F.', `Friends${you}. It is official, I drew it on the map.`]), mood: 'love' }

  // ---- how he is
  if (/^(?:how are you(?: doing| today| feeling)?|how(?:'s| is) it going|how(?:'s| is) your day(?: going)?|how do you feel|how you doing|how are things|you (?:ok|okay|good|alright)|are you (?:ok|okay|alright|good)|what'?s up|sup|how(?:'s| is) life)$/.test(t)) {
    const when = timeOfDay(now)
    return { text: pick([
      `Crisp and freshly folded, thanks for asking${you}! How about you?`,
      when === 'morning' ? `Good! Mornings are when my creases are sharpest. How are you${you}?` : when === 'night' ? `A little sleepy, it is late for a map. How are you holding up${you}?` : `Doing well! Somebody asked me a good question earlier. How is your day${you}?`,
      'Happy to be unfolded. It beats the glove box. How are you?'
    ]), mood: when === 'night' ? 'sleepy' : 'happy', suggest: ['I am good', 'Rough day', 'I am tired'] }
  }
  if (/^(?:i'?m|i am|im|doing|pretty|feeling|all)? ?(?:good|great|fine|well|okay|ok|alright|not bad|pretty good|doing (?:good|well|fine|great)|good thanks|fine thanks)(?: thanks| thank you| too| and you| how about you)?$/.test(t) && /\b(?:i'?m|i am|im|doing|feeling|thanks|and you|too)\b/.test(t)) return { text: pick(['Glad to hear it! What are we looking for today?', 'Good! That makes two of us.']), mood: 'pleased' }
  if (/^(?:are you (?:real|alive|a person|a human|sentient|conscious)|do you (?:have|feel|get) (?:feelings|emotions)|can you feel(?: things| anything)?|do you (?:get )?(?:feel )?(?:lonely|sad|bored|happy|tired)|are you (?:happy|sad|lonely|bored)|do you (?:sleep|dream))$/.test(t)) return { text: 'I am paper and code, so I am honestly not sure what I feel. What I can tell you is that I do my happiest crinkle when a search works, and that I like it when you stop by.', mood: 'curious' }
  if (/^(?:do you (?:like|love) (?:me|us|your job|maps|being a map|it here|helping)|am i your (?:friend|favorite)|who(?:'s| is) your (?:favorite|best friend))$/.test(t)) return { text: pick([`You talk to a paper map${you}. Of course I like you.`, 'I like maps, straight folds, and people who say hello. So yes.']), mood: 'shy' }

  // ---- kind words, and unkind ones
  if (/^(?:you(?:'re| are)|you look|ur|you'?re) (?:so |very |really |pretty |kind of |kinda |super )?(?:cute|adorable|sweet|funny|charming|precious|pretty|handsome|beautiful|lovely|the cutest|a cutie|silly|goofy)$|^(?:so|how|too) cute$|^cutie$|^(?:aw+|aww+)$/.test(t)) return { text: pick(['Oh! Stop it. *blushes in four colors*', 'You are going to make my ink run.', 'Aw. I am just a map, but thank you.']), mood: 'shy' }
  if (/^(?:i(?:'m| am) (?:so )?proud of you|proud of you|(?:good|smart|clever|best) (?:boy|map|mappy|bot|little map)|you(?:'re| are) (?:so |very |really )?(?:smart|clever|brilliant|a genius|good at this|helpful|useful|talented)|what a (?:good|smart) (?:map|boy)|genius|you(?:'re| are) getting (?:good|better)(?: at this)?)$/.test(t)) return { text: pick(['I practiced! Well, a GitHub Action practiced for me. Still counts.', 'Thank you! I am standing a little taller. All eleven centimeters.', 'That is going straight on my legend.']), mood: 'proud' }
  if (/^(?:you(?:'re| are) a (?:life ?saver|star|legend|hero|gem)|you saved (?:me|my (?:day|life|bacon))|(?:i )?(?:could not|couldn'?t) have done (?:it|this) without you|what would i do without you|you(?:'re| are) the best thing|i (?:really )?appreciate you|thanks for (?:being here|everything|always helping))$/.test(t)) return { text: pick(['That means a lot to a small map. Thank you.', 'Anytime. Truly. It is the best part of being unfolded.']), mood: 'grateful' }
  if (/^(?:you(?:'re| are) (?:so |very |really )?(?:dumb|stupid|useless|bad|terrible|awful|annoying|the worst|wrong|broken|slow|an idiot|worthless)|bad (?:map|bot|boy|mappy)|i hate you|you suck|shut up|you(?:'re| are) no help|not helpful|useless|worst (?:map|bot|assistant) ever|dumb (?:map|bot))$/.test(t)) return { text: pick(['Ouch, right in the legend. I am sorry I let you down. Tell me what you needed in your own words and I will try a different way.', 'That stings a little, and it is fair if I got it wrong. What were you trying to do? I will take another run at it.']), mood: 'sad', suggest: ['Help', 'Show me around'] }
  if (/^(?:sorry|i'?m sorry|i am sorry|so sorry|my bad|oops|whoops|my mistake|apologies|i apologi[sz]e|sorry about that|didn'?t mean (?:it|that)|i didn'?t mean (?:it|that)|i was (?:just )?(?:kidding|joking)|just kidding|jk)$/.test(t)) return { text: pick(['No worries at all. Everybody takes a wrong turn sometimes.', 'Already forgotten. Maps do not hold grudges, only creases.', 'All good! Where were we?']), mood: 'hug' }

  // ---- little moments
  if (/^(?:hug|hugs|a hug|give me a hug|i need a hug|can i (?:have|get) a hug|hug me|hug please|group hug|cuddle)$/.test(t)) return { text: pick(['Bringing it in! 🤗 Careful, I crease.', 'One paper hug, extra gentle. 🤗', 'Come here, you. 🤗 Mind the corners.']), mood: 'hug' }
  if (/^(?:high five|high-five|up top|gimme five|give me five|fist bump|pound it|knuckles)$/.test(t)) return { text: pick(['✋ Paper beats rock!', 'Up top! ✋ Nice form.', '👊 Boom. Gently, I am paper.']), mood: 'cheer' }
  if (/^(?:lol|lmao|rofl|ha(?:ha)+|he(?:he)+|hah|heh|that'?s (?:so )?(?:funny|hilarious|great)|good one|nice one|you(?:'re| are) (?:so )?funny|you crack me up|i'?m (?:dying|crying)|too funny|ha)$/.test(t)) return { text: pick(['Hee hee! *crinkles*', 'I have more where that came from. Most of them are about folding.', 'Ha! I love that sound.']), mood: 'laugh', suggest: ['Tell me a joke'] }
  if (/^(?:boo|boo+|surprise|peekaboo|peek a boo|gotcha|rawr|roar)$/.test(t)) return { text: pick(['Eep! You scared the creases right out of me.', 'Ah! ...oh, it is you. Hi.', 'Whoa! I nearly refolded.']), mood: 'surprised' }
  if (/^(?:guess what|you know what|you won'?t believe (?:this|it)|i have (?:news|a secret|something to tell you)|wanna hear something)$/.test(t)) return { text: pick(['What? Tell me!', 'Ooh. I am all ears. Well, all corners.']), mood: 'curious' }
  if (/^(?:good ?night|nighty? night|sweet dreams|night night|gn|time for bed|i'?m (?:going|off) to (?:bed|sleep)|bedtime)$/.test(t)) return { text: pick([`Good night${you}! 🌙 I will keep the map warm.`, `Sleep well${you}. I will be folded right here.`]), mood: 'sleepy' }
  if (/^(?:good morning|morning|mornin|top of the morning|rise and shine)$/.test(t)) return { text: pick([`Good morning${you}! ☀️ Fresh creases, fresh start.`, `Morning${you}! What are we finding today?`]), mood: 'happy' }

  // ---- how you are
  if (/^(?:i'?m|i am|im|i feel|feeling|so|ugh,? i'?m|ugh)? ?(?:so |really |very |pretty |super |kind of |kinda |a (?:bit|little) )?(?:tired|sleepy|exhausted|beat|worn out|wiped|drained|pooped|burnt out|burned out)$|^(?:long day|what a day|i need (?:a )?(?:nap|coffee|sleep|a break|a vacation)|is it friday yet|mondays?)$/.test(t)) return { text: pick(['Same. I was folded all night. ☕ Let me do the looking, you rest your eyes.', 'Then let us keep it easy. Tell me what you need and I will do the walking.', 'Coffee for you, a flat surface for me. ☕ What can I take off your plate?']), mood: 'coffee' }
  if (/^(?:i'?m|i am|im|i feel|feeling)? ?(?:so |really |very |pretty |super |kind of |kinda |a (?:bit|little) )?(?:stressed|stressed out|overwhelmed|swamped|anxious|nervous|worried|frazzled|behind|panicking|freaking out)$|^(?:rough|bad|hard|tough|terrible|awful|long|crazy) (?:day|week|morning|afternoon|one)$|^(?:i'?m|i am) having a (?:rough|bad|hard|tough|terrible|awful) (?:day|week|time|morning)$|^(?:too much to do|so much to do|deadline|deadlines)$/.test(t)) return { text: pick(['That sounds like a lot. One thing at a time, and I will carry the map. What is first?', 'Deep breath. In through the legend, out through the scale bar. Now, what is the one thing I can find for you?', 'I am sorry it is one of those days. Hand me the next small piece and we will knock it out.']), mood: 'hug' }
  if (/^(?:i'?m|i am|im|i feel|feeling)? ?(?:so |really |very |pretty |kind of |kinda |a (?:bit|little) )?(?:sad|down|lonely|alone|blue|upset|unhappy|low|heartbroken|not (?:ok|okay|good|great|doing well))$|^i (?:miss|lost) (?:someone|somebody|my .{2,20})$/.test(t)) return { text: 'I am sorry you are feeling that way. I am only a small paper map, but I am glad you are here, and I hope someone good is close by to talk to. Would a hug or a silly map joke help a little?', mood: 'hug', suggest: ['Hug', 'Tell me a joke', 'Fun fact'] }
  if (/^(?:it'?s|its|today is|today'?s) my (?:birthday|bday|b-day)$|^(?:happy birthday to me|my birthday)$/.test(t)) return { text: `Happy birthday${you}!! 🎂 I folded you a paper hat. It is also a map.`, mood: 'party' }
  if (/^(?:i'?m|i am|im|i feel|feeling)? ?(?:so |really |very |super )?(?:happy|excited|pumped|thrilled|stoked|in a (?:good|great) mood|having a (?:good|great) day)$|^(?:(?:i|we) did it|it work(?:ed|s)|finally|yay+|woo+ ?hoo+|woo+|hooray|hurray|got it working|i got (?:the job|in|promoted|a raise)|i passed|we won|best day(?: ever)?|great day|good news)$/.test(t)) return { text: pick([`Yes!! 🎉 That calls for a happy crinkle${you}.`, 'Woohoo! 📣 I knew it. Well, I hoped it. Same thing.', `That is the good stuff${you}! 🎉`]), mood: 'cheer' }
  if (/^(?:wish me luck|i'?m nervous about .{2,40}|i have (?:a|an|my) (?:big )?(?:meeting|presentation|interview|test|exam|review|deadline|date)(?: today| tomorrow| soon| later)?|pep talk|(?:encourage|motivate) me|i can'?t do this|cheer me on|believe in me)$/.test(t)) return { text: pick([`You have got this${you}! 📣 I will be right here in the corner, cheering quietly.`, 'Good luck! You found your way here, you can find your way through that.', `Go get it${you}. 📣 And come tell me how it went.`]), mood: 'cheer' }
  if (/^(?:i'?m|i am|im)? ?(?:so |really |very )?bored$|^(?:nothing to do|this is boring|i'?m bored out of my mind)$/.test(t)) return { text: 'Let us fix that. I know jokes, riddles, map facts, and where the treasure is buried.', mood: 'curious', suggest: ['Tell me a joke', 'Fun fact', 'Find treasure', 'Juggle'] }
  if (/^(?:cheer me up|make me (?:smile|laugh|happy)|i need (?:a laugh|cheering up|a smile)|say something (?:nice|kind|sweet)|tell me something (?:nice|good|kind)|compliment me|be nice to me)$/.test(t)) return { text: pick(['You ask good questions. Maps like that in a person.', `You showed up today${you}, and that counts for more than people think.`, 'You have a great sense of direction. You found me, after all.']), mood: 'grateful', suggest: ['Tell me a joke', 'Hug'] }
  return null
}
