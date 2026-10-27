/*
  intents.ts - reads what the user typed and decides what they want.
  Ordered rules, first match wins. Anything that matches no rule is a question for the
  retrieval brain ("ask"). Pure TypeScript.
*/
import type { Intent } from './types'
import { normalizeCommand } from './conversation'

type Rule = [RegExp, (m: RegExpMatchArray, raw: string) => Intent | null]

const ART = '(?:the |a |an |my |our )?'
const TAIL = '(?:\\s+(?:widget|tool|panel|window|for me|please|now))*\\s*[?.!]*$'

const clean = (s: string | undefined): string => String(s || '')
  .replace(/^(the|a|an|my|our)\s+/i, '')
  .replace(/\s+(please|for me|now|real quick|asap)$/i, '')
  .replace(/[?.!]+$/, '')
  .trim()

const RULES: Rule[] = [
  [/^(?:explore data|give me data ideas|what can i ask about my data)[!.?]*$/i, (m, raw) => ({ name: 'dataIdeas', raw })],
  [/^(?:explore(?: layer| table)?|what can i ask about|give me (?:data )?ideas for)\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'dataIdeas', target: clean(m[1]), raw })],
  [/^(?:why (?:can't|can not|cannot) i see|why (?:isn't|is not) (?:the )?layer visible|troubleshoot|diagnose)\s+(?:the\s+)?(.+?)(?:\s+layer)?[!.?]*$/i, (m, raw) => ({ name: 'layerDiagnosis', target: clean(m[1]), raw })],
  [/^(?:list|show|what|which)\b.*\btables\b|^tables[!?]*$/i, (m, raw) => ({ name: 'listTables', raw })],
  [/^(?:select|expand|show me|show)\s+(?:the\s+)?(.+?)\s+layer[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^(?:select|activate|show|expand)\s+layer\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^select\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^(?:undo|undo that|go back one step|reverse that)[!.?]*$/i, (m, raw) => ({ name: 'undo', raw })],
  [/^(?:diagnostics|status|what do you know|brain status)[!.?]*$/i, (m, raw) => ({ name: 'diagnostics', raw })],
  [/^(?:commands|command guide|examples|what can you do|help)[!.?]*$/i, (m, raw) => ({ name: 'help', raw })],
  [/^(?:forget context|start over|new conversation)[!.?]*$/i, (m, raw) => ({ name: 'forget', raw })],
  [/^(?:zoom|go|fly) to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)[!?]*$/i, (m, raw) => ({ name: 'coordinates', target: m[1], value: m[2], raw })],
  [/^(?:set )?scale(?: to)?\s+1\s*:\s*([\d,]+)[!.?]*$/i, (m, raw) => ({ name: 'scale', value: m[1].replace(/,/g, ''), raw })],
  [/^(?:set\s+)?(.+?)\s+(opacity|transparency)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: String(m[2].toLowerCase() === 'transparency' ? 100 - Number(m[3]) : Number(m[3])), raw })],
  [/^(hi|hello|hey|yo|sup|howdy|hiya|greetings|good (morning|afternoon|evening))\b[\s!.,]*(mappy)?[\s!.]*$/i, (m, raw) => ({ name: 'greet', raw })],
  [/^(thanks|thank you|thx|ty|cheers|nice|great|awesome|cool|perfect)\b/i, (m, raw) => ({ name: 'thanks', raw })],
  [/^(who|what) are you\b|^what('?s| is) your name|^are you (a |an )?(bot|ai|robot|human)/i, (m, raw) => ({ name: 'whoami', raw })],
  [/^(help|\?|commands|what can (you|i) (do|ask)|how do (i|you) use (you|this|mappy)|what do you do)\b/i, (m, raw) => ({ name: 'help', raw })],
  [/\b(tell me )?(a )?(joke|pun|make me laugh|something funny)\b/i, (m, raw) => ({ name: 'joke', raw })],
  [/^(go away|bye|goodbye|bye bye|see ya|see you|later|hide|hide yourself|go hide|sleep|go to sleep|nap|take a nap|shh+|be quiet|quiet|shut up)[\s!.]*(mappy)?[\s!.]*$/i, (m, raw) => ({ name: 'sleep', raw })],
  [/^(tip|give me a tip|surprise me|random tip|did you know)\b/i, (m, raw) => ({ name: 'tip', raw })],
  [/^(clear|remove|reset)\s+(the\s+)?(highlights?|selection|results|graphics|search)\b/i, (m, raw) => ({ name: 'clear', raw })],
  [/^(what is|what's|tell me about|about|explain)\s+(this|the) (app|site|application|experience|page|map viewer)\b|^about$/i, (m, raw) => ({ name: 'about', raw })],

  // Map navigation
  [/^(zoom|go|take me|fly)\s+(to\s+)?(full|home|initial|start(ing)?|default|whole|everything|the whole (map|city|area))(\s+extent)?\b/i, (m, raw) => ({ name: 'home', raw })],
  [/^(zoom\s+(in|out)|(in|out)\b)/i, (m, raw) => ({ name: 'zoom', value: /out/i.test(m[0]) ? 'out' : 'in', raw })],
  [/^(where am i|what'?s here|where is (this|the map)|current location|map center|what are (the|my) coordinates|coordinates)\b/i, (m, raw) => ({ name: 'whereami', raw })],

  // Lists
  [/^(list|show|what|which)\b.*\b(visible|on|turned on|active)\b.*\blayers?\b|^(list|show|what|which)\b.*\blayers?\b.*\b(on|visible|showing|turned on|active)\s*[?.!]*$|^(visible|active) layers/i, (m, raw) => ({ name: 'listLayers', value: 'visible', raw })],
  [/^(list|show( me)?|what|which)\b.*\blayers\b|^layers\??$/i, (m, raw) => ({ name: 'listLayers', raw })],
  [/^(list|show( me)?|what|which)\b.*\b(widgets|tools|features of (this|the) app)\b|^(tools|widgets)\??$/i, (m, raw) => ({ name: 'listWidgets', raw })],
  [/^(list|show( me)?|what|which)\b.*\b(pages|views|tabs|windows)\b|^(pages|views)\??$/i, (m, raw) => ({ name: 'listPages', raw })],
  [/^(list|show( me)?|what|which)\b.*\bbookmarks?\b|^bookmarks?\??$/i, (m, raw) => ({ name: 'listBookmarks', raw })],
  [/^(list|show( me)?|what|which)\b.*\blinks\b|^links\??$/i, (m, raw) => ({ name: 'listLinks', raw })],

  // Layer list (before the generic layer rules)
  [/^(?:turn|switch|shut)\s+(?:off\s+)?(?:all|every|everything)(?:\s+(?:the\s+)?layers?)?\s*(?:off)?[?.!]*$|^(?:hide|clear)\s+(?:all|every)\s+(?:the\s+)?layers?[?.!]*$|^all layers off[?.!]*$/i, (m, raw) => ({ name: 'allOff', raw })],
  [new RegExp('^(?:only show|show only|just show|solo|isolate|only)\\s+' + ART + '(.+?)(?:\\s+layers?)?' + TAIL, 'i'), (m, raw) => ({ name: 'solo', target: clean(m[1]), raw })],
  [/^(?:where(?:'s| is| are)|show me|find|reveal|highlight|point to|open|expand)\s+(?:the\s+)?(.+?)\s+(?:layer|layers|group)\s+(?:in|on)\s+(?:the\s+)?(?:layer list|map layers|layers list|layers panel|table of contents|toc)[?.!]*$/i, (m, raw) => ({ name: 'reveal', target: clean(m[1]), raw })],
  [/^(?:where(?:'s| is| are)|show me|find|reveal|point to)\s+(?:the\s+)?(.+?)\s+(?:in|on)\s+(?:the\s+)?(?:layer list|map layers|layers list|layers panel|table of contents|toc)[?.!]*$/i, (m, raw) => ({ name: 'reveal', target: clean(m[1]), raw })],
  [/^(?:where(?:'s| is| are))\s+(?:the\s+)?(.+?)\s+(?:layer|layers|group)[?.!]*$/i, (m, raw) => ({ name: 'reveal', target: clean(m[1]), raw })],
  [/^(?:expand|open)\s+(?:the\s+)?(.+?)\s+group[?.!]*$/i, (m, raw) => ({ name: 'reveal', target: clean(m[1]), raw })],
  [/^(list|show( me)?|what|which)\b.*\b(presets?|layer views|saved views)\b|^presets\??$/i, (m, raw) => ({ name: 'listPresets', raw })],
  [/^(?:apply|use|load|switch to|turn on)\s+(?:the\s+)?(.+?)\s+(?:preset|layer view|view)[?.!]*$/i, (m, raw) => ({ name: 'preset', target: clean(m[1]), raw })],
  [/\b(favou?rite|starred)\s+layers?\b|^(my )?favou?rites\??$/i, (m, raw) => ({ name: 'favorites', raw })],
  [/^(open|show)\s+(the\s+)?(layer list|layers list|map layers|table of contents|toc)[?.!]*$/i, (m, raw) => ({ name: 'openLayerList', raw })],

  // Layers
  [new RegExp('^(?:turn|switch|toggle)\\s+on\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [new RegExp('^(?:turn|switch|toggle)\\s+off\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'layerOff', target: clean(m[1]), raw })],
  [new RegExp('^(?:turn|switch|toggle)\\s+' + ART + '(.+?)\\s+(on|off)' + TAIL, 'i'), (m, raw) => ({ name: m[2].toLowerCase() === 'on' ? 'layerOn' : 'layerOff', target: clean(m[1]), raw })],
  [new RegExp('^(?:show|display|enable|add)\\s+' + ART + '(.+?)\\s+layer' + TAIL, 'i'), (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [new RegExp('^(?:hide|remove|disable)\\s+' + ART + '(.+?)\\s+layer' + TAIL, 'i'), (m, raw) => ({ name: 'layerOff', target: clean(m[1]), raw })],
  [/\b(?:opacity|transparency)\b.*?\b(?:of|for|on)\s+(?:the\s+)?(.+?)\s+(?:to\s+)?(\d{1,3})\s*%?/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: m[2], raw })],
  [/^(?:set|make)\s+(?:the\s+)?(.+?)\s+(?:opacity|transparency)?\s*(?:to\s+)?(\d{1,3})\s*%/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: m[2], raw })],
  [/^(?:what(?:'s| is| are)?\s+(?:in|inside)|fields (?:in|of|for)|attributes (?:in|of|for)|columns (?:in|of|for)|describe(?: the)? layer|what data is in)\s+(?:the\s+)?(.+?)[?.!]*$/i, (m, raw) => ({ name: 'fields', target: clean(m[1]), raw })],
  [/^(?:how many|count(?: the)?|number of)\s+(.+?)(?:\s+(?:are|is) (?:there|on the map|in view|visible|here))?[?.!]*$/i, (m, raw) => ({ name: 'count', target: clean(m[1]), scope: /in view|visible|here|on screen/i.test(raw) ? 'view' : undefined, raw })],

  // Features
  [/^(?:find|search(?: for)?|locate|look ?up|where(?:'s| is| are)|show me where)\s+(.+?)\s+(?:in|on|within|from)\s+(?:the\s+)?(.+?)\s*(?:layer)?[?.!]*$/i, (m, raw) => ({ name: 'find', target: clean(m[1]), scope: clean(m[2]), raw })],
  [/^(?:find|search(?: for)?|locate|look ?up|where(?:'s| is| are)|show me where)\s+(.+?)[?.!]*$/i, (m, raw) => ({ name: 'find', target: clean(m[1]), raw })],

  // Navigation and widgets
  [new RegExp('^(?:close|hide|dismiss)\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'close', target: clean(m[1]), raw })],
  [new RegExp('^(?:zoom|go|take me|fly|navigate|jump|switch)\\s+(?:to|into)\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'goto', target: clean(m[1]), raw })],
  [new RegExp('^(?:open|launch|start|run|bring up|pull up|show me|show|use|activate)\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'open', target: clean(m[1]), raw })],
  [/^(?:how (?:do|can) i|how to|can i|is there a way to|i (?:want|need) to|help me)\s+(.+?)[?.!]*$/i, (m, raw) => ({ name: 'howto', target: clean(m[1]), raw })]
]

export function parseIntent (input: string): Intent {
  const raw = normalizeCommand(String(input || ''))
  const count = raw.match(/^(?:how many|count(?: the)?|number of)\s+(.+?)\s+(?:(?:are|is)\s+)?(?:in view|visible|here|on screen|on the map)[?.!]*$/i)
  if (count) return { name: 'count', target: clean(count[1]), scope: 'view', raw }
  for (const [rx, fn] of RULES) {
    const m = raw.match(rx)
    if (m) {
      const intent = fn(m, raw)
      if (intent && (intent.target === undefined || intent.target.length > 0)) return intent
    }
  }
  return { name: 'ask', target: raw, raw }
}
