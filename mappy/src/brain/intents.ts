/*
  intents.ts - reads what the user typed and decides what they want.
  Ordered rules, first match wins. Anything that matches no rule is a question for the
  retrieval brain ("ask"). Pure TypeScript.
*/
import type { Intent } from './types'
import { normalizeCommand } from './conversation'

type Rule = [RegExp, (m: RegExpMatchArray, raw: string) => Intent | null]

const ART = '(?:the |a |an |my |our )?'
/** "Show only X": a layer name, not a question ("just show me how to print") or a filter ("only parcels where acres > 5"). */
function soloOf (target: string, raw: string): Intent | null {
  const t = clean(target)
  if (!t || /\b(?:how|where|what|why|who|can|could|should|edit|with|whose|where|in view|on screen|me how)\b|[<>=]/i.test(t) || t.split(/\s+/).length > 6) return null
  return { name: 'solo', target: t, raw }
}

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
  [/^(?:select|expand|show me|show)\s+(?!only\b|just\b)(?:the\s+)?(.+?)\s+layer[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^show\s+(?:only|just)\s+(?:the\s+)?(.+?)\s+layer[!.?]*$/i, (m, raw) => soloOf(m[1], raw)],
  [/^(?:select|activate|show|expand)\s+layer\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^select\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^(?:undo|undo that|go back one step|reverse that|undo (?:the )?(?:basemap|background)(?: change)?|put the (?:basemap|background) back)[!.?]*$/i, (m, raw) => ({ name: 'undo', raw })],
  [/^(?:diagnostics|status|what do you know|brain status)[!.?]*$/i, (m, raw) => ({ name: 'diagnostics', raw })],
  [/^(?:commands|command guide|examples|what can you do|help)[!.?]*$/i, (m, raw) => ({ name: 'help', raw })],
  [/^(?:forget context|start over|new conversation)[!.?]*$/i, (m, raw) => ({ name: 'forget', raw })],
  [/^(?:zoom|go|fly) to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)[!?]*$/i, (m, raw) => ({ name: 'coordinates', target: m[1], value: m[2], raw })],
  [/^(?:make|set|turn)\s+(?:the\s+)?(.+?)\s+(?:(\d{1,3})\s*%\s*|half\s+|partly\s+|a\s+bit\s+|somewhat\s+)?(?:transparent|see[- ]through|faded|translucent)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: String(m[2] ? 100 - Number(m[2]) : 50), raw })],
  [/^(?:make|set|turn)\s+(?:the\s+)?(.+?)\s+(?:solid|opaque|fully visible|not transparent)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: '100', raw })],
  [/^fade(?: out)?\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: '50', raw })],
  [/^(?:set )?scale(?: to)?\s+1\s*:\s*([\d,]+)[!.?]*$/i, (m, raw) => ({ name: 'scale', value: m[1].replace(/,/g, ''), raw })],
  [/^(?:set\s+)?(.+?)\s+(opacity|transparency)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: String(m[2].toLowerCase() === 'transparency' ? 100 - Number(m[3]) : Number(m[3])), raw })],
  [/^(hi|hello|hey|yo|sup|howdy|hiya|greetings|good (morning|afternoon|evening))\b[\s!.,]*(mappy)?[\s!.]*$/i, (m, raw) => ({ name: 'greet', raw })],
  [/^(thanks|thank you|thx|ty|cheers|nice|great|awesome|cool|perfect)\b/i, (m, raw) => ({ name: 'thanks', raw })],
  [/^(?:i\s+(?:love|like|adore)\s+(?:you|u|mappy)|love (?:you|u|ya)|you(?:'re| are)\s+(?:the best|awesome|amazing|great|my (?:bff|best friend|buddy|pal)|so (?:smart|helpful|cute))|(?:good|great|nice)\s+(?:job|work|boy|one)|best friend|bff|high five|hug|you rock)\b/i, (m, raw) => ({ name: 'thanks', raw })],
  [/^(who|what) are you\b|^what('?s| is) your name|^are you (a |an )?(bot|ai|robot|human)/i, (m, raw) => ({ name: 'whoami', raw })],
  [/^(help|\?|commands|what can (you|i) (do|ask)|how do (i|you) use (you|this|mappy)|what do you do)\b/i, (m, raw) => ({ name: 'help', raw })],
  [/\b(tell me )?(a )?(joke|pun|make me laugh|something funny)\b/i, (m, raw) => ({ name: 'joke', raw })],
  [/^(go away|bye|goodbye|bye bye|see ya|see you|later|hide|hide yourself|go hide|sleep|go to sleep|nap|take a nap|shh+|be quiet|quiet|shut up)[\s!.]*(mappy)?[\s!.]*$/i, (m, raw) => ({ name: 'sleep', raw })],
  [/^(tip|give me a tip|surprise me|random tip|did you know)\b/i, (m, raw) => ({ name: 'tip', raw })],
  [/^(clear|remove|reset)\s+(the\s+)?(highlights?|selection|results|graphics|search)\b/i, (m, raw) => ({ name: 'clear', raw })],
  [/^(what is|what's|tell me about|about|explain)\s+(this|the) (app|site|application|experience|page|map viewer)\b|^about$/i, (m, raw) => ({ name: 'about', raw })],

  // Map words people say instead of tool names
  [/^(?:what does (?:the |this |that )?(?:\w+ )?(?:line|lines|area|areas|dot|dots|dashed line|outline|shading|hatching|color|colou?r|symbol|icon|marker|fill|pattern) mean|what(?:'s| is) (?:the |this |that )?(?:\w+ )?(?:line|area|dot|outline|shading|symbol|marker)(?: on the map)?|what is the legend for .+)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'legend', raw })],
  [/^(?:nothing (?:is )?(?:on|showing|showing on|showing up on|drawing on)(?: the map)?|the map is (?:blank|empty|white|gray|grey|loading|not loading)|i (?:don'?t|can'?t) see (?:anything|any layers|the layers|the map)|no layers (?:are )?(?:showing|on)|why is the map (?:blank|empty)|where is everything|where did everything go|what is (?:on|showing on) the map|what is showing|what layers? (?:is|are) showing)[?.!]*$/i, (m, raw) => ({ name: 'mapBlank', raw })],
  [/^(?:(?:the\s+)?(.+?)\s+(?:layer\s+)?(?:is|isn'?t|is not|won'?t|doesn'?t|does not|aren'?t|are not|do not|don'?t)\s+(?:showing|show|showing up|visible|drawing|draw|appear|appearing|display|displaying|working|there|on the map|loading|load)(?: up)?|i (?:can'?t|cannot|don'?t) see (?:the\s+)?(.+?)(?:\s+layer)?(?:\s+on the map)?|where did (?:the\s+)?(.+?)(?:\s+layer)? go|why (?:is|isn'?t|are|aren'?t|did|does|doesn'?t|won'?t|can'?t)\s+(?:i see\s+)?(?:the\s+)?(.+?)(?:\s+layer)?\s*(?:not\s+)?(?:showing|show|visible|drawing|draw|appear|appearing|display|there|disappear|gone|missing|hidden|load)(?: up| when i zoom(?:ed)? (?:in|out))?)[?.!]*$/i, (m, raw) => ({ name: 'layerDiagnosis', target: clean(m[1] || m[2] || m[3] || m[4]), raw })],
  [/^(?:(?:turn on|show|add|enable|display)\s+(?:the\s+)?labels?(?:\s+(?:for|on)\s+(?:the\s+)?(.+?))?|label\s+(?:the\s+)?(.+?))[?.!]*$/i, (m, raw) => ({ name: 'labels', target: clean(m[1] || m[2]) || undefined, value: 'on', raw })],
  [/^(?:(?:turn off|hide|remove|disable)\s+(?:the\s+)?labels?(?:\s+(?:for|on)\s+(?:the\s+)?(.+?))?|unlabel\s+(?:the\s+)?(.+?))[?.!]*$/i, (m, raw) => ({ name: 'labels', target: clean(m[1] || m[2]) || undefined, value: 'off', raw })],
  [/^(?:when|how (?:current|up to date|recent|old)|how often)\s+(?:is|was|are|were|does|do)\s+(?:the\s+|this\s+)?(.+?)(?:\s+(?:data|layer|imagery|photo|photos|aerials?))?\s+(?:updated|last updated|taken|flown|refreshed|edited|changed|collected|surveyed|current|maintained)[?.!]*$|^(?:who (?:maintains|keeps|made|created|publishes|is responsible for)|where (?:does|did)|what is the source of)\s+(?:the\s+|this\s+)?(.+?)(?:\s+(?:data|layer))?(?:\s+(?:come from|from))?[?.!]*$|^(?:is this map accurate|how accurate (?:is|are) (?:the\s+|this\s+)?(.+?)|(?:map |data )?disclaimers?|(?:terms of use|accuracy|data accuracy)|can i use this map for a survey|is this a survey|are the parcel lines (?:exact|accurate|surveyed))[?.!]*$/i, (m, raw) => ({ name: 'dataInfo', target: clean(m[1] || m[2] || m[3]) || 'this map', raw })],
  [/^(?:cancel|stop|never ?mind|forget it|skip it|no thanks|nah|nope|drop it|leave it)[.!]*$/i, (m, raw) => ({ name: 'cancel', raw })],
  [/^(?:yes|yeah|yep|yup|sure|ok|okay|k|alright|fine|no|nope|cool|got it|i see|right|correct|exactly|indeed|true|good|great|awesome|nice|perfect|wow|hmm|hm|huh|oh|ah|lol|haha|ha)[.!?]*$/i, (m, raw) => ({ name: 'ack', raw })],
  [/^(?:repeat (?:that|it)|say (?:that|it) again|what did you (?:say|just say)|come again|pardon|sorry what)[?.!]*$/i, (m, raw) => ({ name: 'repeat', raw })],
  [/^(?:read (?:that|it|the answer|this) (?:aloud|out loud|to me)|speak (?:that|it|the answer)|say (?:that|it) out loud)[?.!]*$/i, (m, raw) => ({ name: 'speak', raw })],
  [/^(?:make yourself|be|get)\s+(smaller|bigger|larger|tiny|huge)[?.!]*$|^(smaller|bigger)\s+(?:mappy|please)?[?.!]*$/i, (m, raw) => ({ name: 'resize', value: /small|tiny/i.test(m[1] || m[2]) ? 'smaller' : 'bigger', raw })],
  [/^(?:move|go|scoot|slide)\s+(?:yourself\s+)?(?:to the\s+)?(left|right)(?:\s+(?:side|corner))?[?.!]*$|^(?:move|go) to the other (?:side|corner)[?.!]*$/i, (m, raw) => ({ name: 'moveCorner', value: (m[1] || 'other').toLowerCase(), raw })],
  [/^(?:stop (?:moving|animating|dancing|wiggling|bouncing)|hold still|stay still|freeze|pause (?:the )?animations?)[?.!]*$/i, (m, raw) => ({ name: 'pause', value: 'on', raw })],
  [/^(?:start (?:moving|animating) again|unpause|resume animations?|you can move again|animate again)[?.!]*$/i, (m, raw) => ({ name: 'pause', value: 'off', raw })],
  [/^(?:expand|open up|unfold)\s+(?:the\s+)?(.+?)(?:\s+(?:group|folder))?[?.!]*$/i, (m, raw) => ({ name: 'reveal', target: clean(m[1]), raw })],
  [/^(?:what do the (?:colou?rs|symbols) mean|what does (?:the |this |that )?(?:colou?r|symbol|shading|hatching) mean|what (?:colou?r|symbol) is .+|explain the (?:colou?rs|symbols|legend)|key to the map|map key)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'legend', raw })],
  [/^(?:print|export|save)\s+(?:this |the |a )?(?:map|page|view|screen)(?:\s+(?:to|as)\s+(?:a\s+)?(?:pdf|image|png|jpe?g))?[?.!]*$|^(?:make|create|get)\s+(?:a\s+)?(?:pdf|printout|print)(?:\s+of (?:this |the )?map)?[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'print', raw })],
  [/^(?:share|send|email|text)\s+(?:this |the )?(?:map|view|link)(?:\s+(?:to|with)\s+.+)?[?.!]*$|^(?:get|copy)\s+(?:a |the )?(?:share(?:able)?\s+)?link(?:\s+to (?:this |the )?map)?[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'share', raw })],
  [/^(?:measure|how (?:long|far|big|wide|large) is (?:this|that|it)|measure (?:a |the )?(?:distance|area|line|length|perimeter)|distance tool|measuring tool)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'measure', raw })],
  [/^(?:draw|sketch|mark ?up|annotate|add (?:a |some )?(?:note|notes|text|label|marker|shape|drawing|markup|sketch|arrow|point|line|polygon)(?: to| on)?(?: the)?(?: map)?|draw on the map|drawing tool)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'draw', raw })],
  [/^(?:change|switch|choose|pick|select|set)\s+(?:the\s+)?(?:basemap|base map|background(?: map)?)[?.!]*$|^(?:other|different|more)\s+(?:basemaps?|backgrounds?)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'basemap gallery', raw })],
  [/^(?:what|which|list(?: the)?|show(?: me)?(?: the)?)\s+(?:basemaps|base maps|backgrounds)(?:\s+(?:are there|are available|can i (?:use|pick)|do you have))?[?.!]*$|^(?:basemaps|base maps)\??$/i, (m, raw) => ({ name: 'listBasemaps', raw })],
  [/^(?:switch|change|set|flip)\s+(?:the\s+)?(?:basemap|base map|background|map)?\s*(?:to)\s+(?:the\s+)?(imagery|aerials?|aerial (?:view|imagery|photos?)|satellite(?: view| imagery)?|streets?(?: view| map)?|topo(?:graphic)?(?: map)?|terrain|gray(?: canvas)?|grey(?: canvas)?|light gray|dark(?: gray)?|hybrid|osm|open ?street ?map|navigation|oceans|national geographic|plain)(?:\s+(?:basemap|base map|background|view|map))?[?.!]*$|^(?:show|use|give me)\s+(?:the\s+)?(imagery|aerials?|aerial (?:view|imagery|photos?)|satellite(?: view| imagery)?|streets?|topo(?:graphic)?|terrain|gray canvas|grey canvas|hybrid)\s+(?:basemap|base map|background|view)[?.!]*$|^(?:satellite|imagery|aerial|aerials|topo|streets|hybrid)\s+(?:view|basemap|mode|background)[?.!]*$|^(?:satellite|imagery|aerial view|aerials)[?.!]*$/i, (m, raw) => ({ name: 'basemap', target: clean(m[1] || m[2] || raw), raw })],
  [/^(?:what(?:'s| is) the (?:map |current )?scale|(?:map |current )?scale\??|how zoomed in (?:am i|is (?:this|the map))|what zoom level)[?.!]*$/i, (m, raw) => ({ name: 'scaleInfo', raw })],
  [/^(?:go|take me|jump)\s+back(?:\s+(?:to (?:where i was|the (?:previous|last) (?:view|extent|place)|previous|last))?)?[?.!]*$|^(?:previous|last)\s+(?:view|extent)[?.!]*$|^back[?.!]*$/i, (m, raw) => ({ name: 'goBack', raw })],
  [/^(?:clear|reset|wipe)\s+(?:the\s+)?(?:map|screen|everything|all)(?:\s+(?:please|now))?[?.!]*$|^(?:start fresh|start over on the map|clean (?:the )?map)[?.!]*$/i, (m, raw) => ({ name: /reset/i.test(raw) ? 'resetMap' : 'clear', raw })],
  [/^(?:what|which)\s+(?:are the |are |is the )?(?:possible |available |valid |different |all the )?(.+?)\s+(?:types|kinds|values|codes|categories|classes|options|choices)(?:\s+(?:are there|exist|are available|can there be|do you have|are possible))?[?.!]*$|^(?:list|show(?: me)?)\s+(?:the\s+|all\s+)?(.+?)\s+(?:types|kinds|values|codes|categories|classes|options)[?.!]*$|^what (?:values|options) (?:can|does) (.+?) (?:have|take|be)[?.!]*$|^what (?:are|is) (?:the )?(?:possible |valid |allowed )?(?:values|options) (?:for|of|in) (.+?)[?.!]*$/i, (m, raw) => ({ name: 'values', target: clean(m[1] || m[2] || m[3] || m[4]), raw })],
  [/^(?:what|which)\s+(?:fields|columns|attributes|information|info|data|details)\s+(?:does|do|are (?:in|on)|is (?:in|on))\s+(?:the\s+)?(.+?)\s+(?:have|has|contain|include|hold)?[?.!]*$/i, (m, raw) => ({ name: 'fields', target: clean(m[1]).replace(/\s+(?:layer|table)$/i, ''), raw })],
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
  [/^turn on every layer anyway[?.!]*$/i, (m, raw) => ({ name: 'allOn', value: 'force', raw })],
  [/^(?:turn|switch|flip)\s+(?:on\s+)?(?:all|every|everything)(?:\s+(?:of\s+)?(?:the\s+)?layers?)?\s*(?:on)?[?.!]*$|^(?:turn|switch)\s+on\s+(?:all|every)(?:\s+(?:of\s+)?(?:the\s+)?layers?)?[?.!]*$|^all layers on[?.!]*$|^(?:show|display) (?:all|every|everything)(?: of)?(?: the)? layers? on the map[?.!]*$/i, (m, raw) => (/\bon\b|^show|^display/i.test(raw) ? { name: 'allOn', raw } : null)],
  [new RegExp('^(?:only show|show only|just show|solo|isolate|only)\\s+(?:me\\s+)?' + ART + '(.+?)(?:\\s+layers?)?' + TAIL, 'i'), (m, raw) => soloOf(m[1], raw)],
  // "turn on only towers and everything else off", "turn on towers and the rest off", "show just parks",
  // "turn everything off except towers", "hide all but parcels", "towers only".
  [new RegExp('^(?:turn|switch|flip)\\s+on\\s+(?:only|just)\\s+' + ART + '(.+?)(?:\\s+layers?)?(?:\\s*(?:,|and)\\s*(?:turn\\s+|switch\\s+)?(?:off\\s+)?(?:everything|all|the rest|all (?:the )?(?:other|others)|every other)(?:\\s+(?:else|others?|other layers?|layers?))?(?:\\s+off)?)?' + TAIL, 'i'), (m, raw) => soloOf(m[1], raw)],
  [new RegExp('^(?:turn|switch)\\s+on\\s+' + ART + '(.+?)(?:\\s+layers?)?\\s*(?:,|and)\\s*(?:turn\\s+|switch\\s+)?(?:off\\s+)?(?:everything|all|the rest|all (?:the )?others?|every other)(?:\\s+(?:else|others?|other layers?|layers?))?(?:\\s+off)?' + TAIL, 'i'), (m, raw) => soloOf(m[1], raw)],
  [new RegExp('^(?:(?:turn|switch|shut)\\s+(?:off\\s+)?(?:everything|all(?: the)?(?: layers?)?)(?:\\s+off)?|hide\\s+(?:everything|all(?: the)?(?: layers?)?))\\s+(?:except|but|other than|besides)\\s+' + ART + '(.+?)(?:\\s+layers?)?' + TAIL, 'i'), (m, raw) => soloOf(m[1], raw)],
  [new RegExp('^(?:show|turn on|display)\\s+' + ART + '(.+?)\\s+only' + TAIL, 'i'), (m, raw) => soloOf(m[1], raw)],
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
  [new RegExp('^(?:zoom|go|take me|fly|navigate|jump|switch|pan|center|centre|move the map|center the map|centre the map|pan the map|zoom the map|zoom in on|zoom in to)\\s+(?:to|into|on|at)\\s+' + ART + '(.+?)' + TAIL, 'i'), (m, raw) => ({ name: 'goto', target: clean(m[1]), raw })],
  [/^(?:show me where|where are|where is|where'?s)\s+(?:the\s+|all(?: the| of the)?\s+)?(.+?)(?:\s+(?:are|is|located|at|on the map))?[?.!]*$|^show me all(?: the| of the)?\s+(.+?)[?.!]*$/i, (m, raw) => ({ name: 'showLayer', target: clean(m[1] || m[2]), raw })],
  [/^(?:what|which)\s+(.+?)\s+(?:are there|do you have|are on the map|exist|are available)[?.!]*$|^list(?: me)?(?: all)?(?: the)?\s+(.+?)(?:\s+on the map)?[?.!]*$/i, (m, raw) => ({ name: 'listFeatures', target: clean(m[1] || m[2]), raw })],
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
