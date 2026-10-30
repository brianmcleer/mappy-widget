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
  // Everyday ways to ask for a layer, a place or a fact
  [/^(?:what(?:'s|s| is) the (?:average|typical|mean|median) (?:lot|parcel|property) size|how big is the (?:average|typical) (?:lot|parcel|property)|average (?:lot|parcel|property) size)[!.?]*$/i, (m, raw) => ({ name: 'avgSize', raw })],
  [/^how many\s+(.+?)\s+(?:per|in a|in each|for every)\s+(square mile|sq\.? ?mi|square kilometer|square km|sq\.? ?km|acre|hectare)[!.?]*$|^(?:density of|how dense are)\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'density', target: clean(m[1] || m[3]), value: (m[2] || 'square mile').toLowerCase(), raw })],
  [/^compare\s+(?:the\s+)?(.+?)\s+(?:layer\s+)?(?:and|with|to|vs\.?|versus|against)\s+(?:the\s+)?(.+?)(?:\s+layers?)?[!.?]*$/i, (m, raw) => ({ name: 'compareLayers', target: clean(m[1]), value: clean(m[2]), raw })],
  [/^(?:what(?:'s|s| is) the difference between|difference between|how (?:is|are|do|does)\s+(?:a |an |the )?)\s*(.+?)\s+(?:and|vs\.?|versus)\s+(?:a |an |the )?(.+?)(?:\s+differ(?:ent)?)?[!.?]*$/i, (m, raw) => ({ name: 'difference', target: clean(m[1]), value: clean(m[2]), raw })],
  // The place in numbers: the Census (and other sources) facts the builder saved
  [/^(?:census(?: facts?| data| numbers| info)?|(?:show|tell|give) me (?:the )?census(?: facts?| data| numbers)?|demographics|(?:the )?(?:town|city|county|place) in numbers|(?:local )?stats|(?:(?:what(?:'s|s| is) )?the )?(population|median age|median home (?:value|price)|home value|households?|average commute|commute(?: time)?|elevation|climate|weather like|average rain(?:fall)?|snowfall)(?: (?:of|in|for) (?:the |this )?(?:town|city|county|place|here|area|.+?))?|how many people live (?:here|in (?:the |this )?(?:town|city|county|area|.+?))|how (?:old|big|high|hot|cold|snowy|rainy) is (?:the |this )?(?:town|city|county|place|area|it|.+?)|how much (?:snow|rain) (?:does|do) (?:we|it|the (?:town|city)|.+?) get|when was (?:the |this )?(?:town|city|county|place|it|.+?) founded)[?.!]*$/i, (m, raw) => ({ name: 'placeStats', value: (m[1] || '').toLowerCase() || raw.toLowerCase(), raw })],
  // Filters on the map itself (the layer's definition expression), saved views, charts, pans and turns
  [/^(?:only show|show only|show just|just show|display only|limit (?:the )?(.+?) to)\s*(?:the\s+)?(.+?)\s+(?:where|with|that (?:are|have|is)|which (?:are|have))\s+(.+?)(?:\s+on the map)?[!.?]*$/i, (m, raw) => ({ name: 'mapFilter', target: clean(m[1] || m[2]), value: m[3].trim(), raw })],
  [/^(?:only show|show only|show just|just show)\s+(?:the\s+)?(.+?)\s+((?:over|under|above|below|bigger than|larger than|smaller than|less than|more than|greater than|older than|newer than|before|after|since|in the last|edited|updated|installed|inspected|built)\b.+?)(?:\s+on the map)?[!.?]*$/i, (m, raw) => ({ name: 'mapFilter', target: clean(m[1]), value: m[2].trim(), raw })],
  [/^(?:filter|restrict|narrow)\s+(?:the\s+)?(?:map\s+)?(?:to\s+)?(?:the\s+)?(.+?)(?:\s+layer)?\s+(?:to|where|by|so that|down to)\s+(.+)[!.?]*$/i, (m, raw) => ({ name: 'mapFilter', target: clean(m[1]), value: m[2].trim(), raw })],
  [/^(?:hide|drop|remove)\s+(?:the\s+)?(.+?)\s+((?:under|below|over|above|smaller than|bigger than|less than|more than|older than|newer than|before|after|where|with|that (?:are|have))\b.+)[!.?]*$/i, (m, raw) => ({ name: 'mapFilter', target: clean(m[1]), value: m[2].trim(), scope: 'inverse', raw })],
  [/^(?:clear|remove|drop|reset|undo|turn off|take off)\s+(?:the\s+|my\s+|all\s+)?filters?(?:\s+(?:on|from|for)\s+(?:the\s+)?(.+?))?[!.?]*$|^(?:show (?:all|every|everything)(?: of)?(?: the)?\s+(.+?) again|unfilter\s+(?:the\s+)?(.+?))[!.?]*$/i, (m, raw) => ({ name: 'mapUnfilter', target: clean(m[1] || m[2] || m[3]) || undefined, raw })],
  [/^(?:what(?:'s|s| is) filtered|which layers are filtered|what filters are on|(?:list|show) (?:my |the )?filters)[!.?]*$/i, (m, raw) => ({ name: 'mapFilters', raw })],
  [/^(?:save|remember|keep|bookmark|store)\s+(?:this\s+)?(?:view|spot|place|location|extent|position|map|where i am)(?:\s+as|\s+called|\s+named|:)?\s+(.+?)[!.?]*$|^(?:save|remember|bookmark) (?:this|here) as\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'saveView', target: clean(m[1] || m[2]), raw })],
  [/^(?:what|which|list|show)(?: (?:my|the))? (?:saved )?(?:views|spots|places) (?:have i saved|did i save|are saved|do i have)[!.?]*$|^(?:my (?:saved )?(?:views|spots|places)|saved (?:views|spots|places)|list (?:my )?saved (?:views|spots|places))[!.?]*$/i, (m, raw) => ({ name: 'listViews', raw })],
  [/^(?:delete|remove|forget|drop)\s+(?:the\s+|my\s+)?(?:saved\s+)?(?:view|spot|place)\s+(?:called\s+|named\s+)?(.+?)[!.?]*$|^(?:delete|remove|forget|drop)\s+(?:the\s+|my\s+)?(.+?)\s+(?:view|spot|place)[!.?]*$/i, (m, raw) => ({ name: 'deleteView', target: clean(m[1] || m[2]), raw })],
  [/^(?:chart|graph|plot|visuali[sz]e)\s+(?:the\s+)?(.+?)\s+(?:by|per|for each)\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'chart', target: clean(m[1]), value: clean(m[2]), raw })],
  [/^(?:chart|graph|plot) (?:that|it|those|the results|the table|this)[!.?]*$|^(?:as|make) a (?:chart|graph)[!.?]*$/i, (m, raw) => ({ name: 'chartLast', raw })],
  [/^(?:pan|move|shift|scroll|nudge|slide)(?: the)?(?: map)?\s+(?:to the\s+)?(north|south|east|west|up|down|left|right)(?:wards?)?(?: a (?:bit|little))?[!.?]*$/i, (m, raw) => ({ name: 'pan', value: m[1].toLowerCase(), raw })],
  [/^(?:north up|north is up|reset (?:the )?rotation|straighten (?:the )?map|un-?rotate|face north|point north)[!.?]*$/i, (m, raw) => ({ name: 'rotate', value: 'north', raw })],
  [/^(?:rotate|turn|spin)(?: the)?(?: map)?(?:\s+(?:by\s+)?(-?\d{1,3})\s*(?:degrees|deg|°)?)?(?:\s+(clockwise|counter-?clockwise|left|right))?[!.?]*$/i, (m, raw) => ({ name: 'rotate', value: String((Number(m[1]) || 90) * (/counter|left/i.test(m[2] || '') ? -1 : 1)), raw })],
  [/^(?:tilt|3d|3-d|3d view|three d|switch to 3d|show (?:in )?3d|bird'?s eye|perspective)[!.?]*$/i, (m, raw) => ({ name: 'threeD', raw })],
  [/^(?:zoom|go) (in|out)\s+(?:(\d+)\s*(?:times|x|steps?|levels?)|twice|a lot|way|all the way|a (?:bit|little|touch|tad)|slightly|once|more|further|closer)[!.?]*$|^zoom\s+(?:way|all the way)\s+(in|out)[!.?]*$/i, (m, raw) => ({ name: 'zoom', value: (m[1] || m[3]).toLowerCase(), target: String(m[2] ? Number(m[2]) : /twice/i.test(raw) ? 2 : /a lot|way|all the way/i.test(raw) ? 3 : /bit|little|touch|tad|slightly/i.test(raw) ? 0.5 : 1), raw })],
  [/^(?:drop|put|place|add|stick)\s+(?:a\s+)?(?:pin|marker|dot|flag)\s+(?:here|there|at the center|in the middle|on the map)?[!.?]*$|^(?:mark|flag|pin)\s+(?:this\s+)?(?:spot|place|location|here)[!.?]*$/i, (m, raw) => ({ name: 'pin', raw })],
  [/^(?:clear|remove|delete)\s+(?:the\s+|my\s+|all\s+)?(?:pins?|markers?|dots?|flags?)[!.?]*$/i, (m, raw) => ({ name: 'clear', raw })],
  [/^(?:center|centre)(?: the map)?\s+(?:on\s+)?(?:here|me|my location|where i am)[!.?]*$|^(?:where am i on the map|show me where i am|find me|locate me|my location)[!.?]*$/i, (m, raw) => ({ name: 'locateMe', raw })],
  [/^(?:what(?:'s|s| is) (?:at|in|under) the (?:center|centre|middle)(?: of the (?:map|screen))?|what(?:'s|s| is) under the crosshair)[!.?]*$/i, (m, raw) => ({ name: 'atCenter', raw })],
  [/^undo\s+(?:the\s+)?(?:last\s+)?(\d+|two|three|four|five)(?:\s+(?:things|steps|changes|actions))?[!.?]*$|^undo\s+(?:everything|all|it all)[!.?]*$/i, (m, raw) => ({ name: 'undoMany', value: m[1] ? String(({ two: 2, three: 3, four: 4, five: 5 } as any)[m[1].toLowerCase()] || Number(m[1])) : '99', raw })],
  [/^(?:redo|redo that|do it again anyway)[!.?]*$/i, (m, raw) => ({ name: 'redo', raw })],
  [/^(?:what did (?:i|you) just do|what did (?:you|i) do|what just happened|what happened|what was that)[!.?]*$/i, (m, raw) => ({ name: 'lastAction', raw })],
  [/^(?:why (?:did you (?:do|say) that|that)|how did you (?:read|understand|get) that|what did you (?:understand|read)|explain (?:that|the last answer|your answer|yourself)|where did that come from|how do you know(?: that)?|source\??)[!.?]*$/i, (m, raw) => ({ name: 'explainLast', raw })],
  [/^(?:simpler|shorter|say (?:that|it) (?:simpler|more simply|in plain (?:english|words)|again but shorter)|plain english|tl;?dr|in short|summari[sz]e that|too long|less words|the short version)[!.?]*$/i, (m, raw) => ({ name: 'shorter', raw })],
  [/^(?:more details?|tell me more|more info|more|elaborate|expand on that|go on about that|details? please|full (?:answer|record|details))[!.?]*$/i, (m, raw) => ({ name: 'more', raw })],
  [/^(?:wait|hold on|hang on|one (?:sec|second|moment)|give me a (?:sec|second|minute)|just a (?:sec|second|minute)|brb)[!.?]*$/i, (m, raw) => ({ name: 'ack', raw })],
  [/^where(?:'s| is| are|s)?\s+(?:the\s+|all the\s+)?(.+?)\s+at[!.?]*$/i, (m, raw) => ({ name: 'showLayer', target: clean(m[1]), raw })],
  [/^(?:fit|frame)\s+(?:the\s+)?(.+?)\s+(?:on (?:the )?screen|to (?:the )?screen|in (?:the )?view|on the map|in the window)[!.?]*$|^(?:zoom|go) to (?:the\s+)?(?:whole|full|entire)\s+(.+?)(?:\s+layer)?[!.?]*$|^(?:go|zoom) to (?:the\s+)?(.+?)\s+extent[!.?]*$/i, (m, raw) => ({ name: 'goto', target: clean(m[1] || m[2] || m[3]), raw })],
  [/^(?:(?:can you |could you |please )?(?:make|change|set|turn)\s+(?:the\s+)?(.+?)\s+(?:bigger|larger|smaller|thicker|thinner|bolder|red|blue|green|yellow|orange|purple|black|white|a different colou?r|another colou?r)|(?:change|set|pick|choose)\s+(?:the\s+)?(?:colou?r|symbol|symbols|size|style|icon|line width)\s+(?:of|for|on)\s+(?:the\s+)?(.+?)|(?:show|draw|display|colou?r)\s+(?:the\s+)?(.+?)\s+in\s+(?:red|blue|green|yellow|orange|purple|black|white|a different colou?r))[!.?]*$/i, (m, raw) => ({ name: 'styleAsk', target: clean(m[1] || m[2] || m[3]), raw })],
  [/^(?:which|what)\s+layer\s+(?:is (?:this|that|it)|am i (?:looking at|on|in)|did i (?:click|select))[!.?]*$|^(?:what(?:'s|s| is) (?:this|that) (?:layer|from)|where (?:is|did) (?:this|that) (?:come )?from)[!.?]*$/i, (m, raw) => ({ name: 'whichLayer', raw })],
  [/^(?:i (?:hate|can'?t stand|don'?t like|dislike) (?:this|the) (?:map|app|site|thing)|this (?:map|app|site) (?:sucks|is (?:terrible|awful|useless|confusing|hard|frustrating|annoying|the worst))|(?:this is|i'?m|im) (?:so )?(?:frustrat(?:ed|ing)|confus(?:ed|ing)|annoy(?:ed|ing)|lost)|ugh+|argh+|grr+|i give up|forget this)[!.?]*$/i, (m, raw) => ({ name: 'frustrated', raw })],
  [/^(?:i (?:want|need|would like|'d like) to see|let me see|can i see|could i see|i wanna see|lemme see|pull up|bring up)\s+(?:the\s+|all\s+(?:the\s+)?)?(.+?)(?:\s+(?:layer|layers|please))?[!.?]*$/i, (m, raw) => ({ name: 'showLayer', target: clean(m[1]), raw })],
  [/^(?:turn|switch|put|bring)\s+(?:the\s+)?(.+?)\s+back\s+on[!.?]*$|^(?:turn|switch)\s+(?:the\s+)?(.+?)\s+on\s+again[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1] || m[2]), raw })],
  [/^(?:make|turn)\s+(?:the\s+)?(.+?)\s+(?:a (?:bit|little) |slightly |more |much )?(lighter|fainter|more transparent|more see[- ]through|darker|stronger|more solid|more opaque|less transparent|bolder)[!.?]*$|^(?:turn|dial)\s+(?:the\s+)?(.+?)\s+(up|down)(?: a (?:bit|little|notch))?[!.?]*$/i, (m, raw) => ({ name: 'opacityStep', target: clean(m[1] || m[3]), value: /lighter|fainter|transparent|see|down/i.test(m[2] || m[4]) ? 'lighter' : 'darker', raw })],
  [/^(?:back to|show|zoom to|go to)\s+(?:the\s+)?(?:whole|full|entire)\s+(?:city|county|map|area|extent|view|thing)[!.?]*$|^(?:zoom|go)\s+(?:all the way\s+)?out(?: all the way)?[!.?]*$|^(?:see|show) (?:everything|it all)[!.?]*$/i, (m, raw) => ({ name: 'home', raw })],
  [/^(?:what(?:'s|s| is) (?:the name of )?(?:this |the )?(?:map|app|site)(?: called| name)?|which (?:map|app) is this|what map am i (?:on|in|looking at))[!.?]*$/i, (m, raw) => ({ name: 'about', raw })],
  [/^(?:is there (?:a|an|any)|do (?:you|we) have (?:a|an|any)?|does (?:this|the) (?:map|app) have (?:a|an|any)?|is there any|do you know (?:about )?(?:the )?)\s*(.+?)(?:\s+(?:layer|layers|data|on (?:the|this) map|in (?:the|this) (?:map|app)|here))?[!.?]*$/i, (m, raw) => ({ name: 'hasLayer', target: clean(m[1]), raw })],
  [/^(?:how many|count(?: the)?|number of)\s+(.+?)\s+(?:can i see|are (?:visible|showing|on (?:the )?screen|in (?:the )?(?:current )?view)|do i see|are there (?:on (?:the )?screen|in view|here))[!.?]*$/i, (m, raw) => ({ name: 'count', target: clean(m[1]), scope: 'view', raw })],
  [/^(?:who owns the most (?:land|property|acres|acreage|parcels|lots)|(?:which|what) owner (?:has|owns) the most (?:land|property|acres|acreage|parcels|lots)|biggest (?:land ?)?owners?|largest (?:land ?)?owners?|top (?:land ?)?owners?)[!.?]*$/i, (m, raw) => ({ name: 'topOwners', value: /parcels|lots/i.test(raw) ? 'count' : 'size', raw })],
  [/^(?:what(?:'s|s| is) (?:the )?(?:date|day)(?: today)?|what day is it|what(?:'s|s| is) today(?:'s date)?|what day of the week is it|what month is it|what year is it|what time is it|what(?:'s|s| is) the time)[!.?]*$/i, (m, raw) => ({ name: 'today', raw })],
  [/^(?!.*\b(?:chat|conversation|transcript|map|screen|view|pdf|image|png|print)\b)(?:can i|how (?:do|can) i|is there a way to|i (?:want|need) to)\s+(?:download|export|save|get)\s+(?:the\s+|a copy of (?:the\s+)?|this\s+)?(.+?)(?:\s+(?:data|layer|as (?:a )?(?:csv|excel|spreadsheet|shapefile|file)|to (?:a )?(?:csv|excel|spreadsheet|shapefile|file)))?[!.?]*$|^(?!.*\b(?:chat|conversation|transcript|map|screen|view|pdf|image|png)\b)(?:download|export)\s+(?:the\s+)?(.+?)(?:\s+(?:to|as) (?:a )?(?:csv|excel|spreadsheet|shapefile|file))?[!.?]*$/i, (m, raw) => ({ name: 'download', target: clean(m[1] || m[2]), raw })],
  [/^(?:the map (?:is|looks) (?:broken|wrong|messed up|off|weird|frozen|stuck)|(?:this|it|something) (?:isn'?t|is not|doesn'?t|does not) (?:working|work|loading|load)|(?:this|it) is broken|something(?:'s| is) wrong|nothing (?:is )?(?:working|happening|loading)|help,? (?:the map|it)(?:'s| is) (?:broken|not working))[!.?]*$/i, (m, raw) => ({ name: 'mapBlank', raw })],
  [/^(?:what else (?:is there|can i do|can you do|do you have|is in (?:here|this app))|what(?:'s|s| is) (?:in|on) (?:here|this app|the app)|what(?:'s|s| is) available|what do (?:we|you) have(?: here)?|show me (?:everything|what(?:'s|s| is) here))[!.?]*$/i, (m, raw) => ({ name: 'help', raw })],
  [/^(?:list|show|what|which)\b.*\btables\b|^tables[!?]*$/i, (m, raw) => ({ name: 'listTables', raw })],
  [/^(?:select|expand|show me|show)\s+(?!only\b|just\b)(?:the\s+)?(.+?)\s+layer[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^show\s+(?:only|just)\s+(?:the\s+)?(.+?)\s+layer[!.?]*$/i, (m, raw) => soloOf(m[1], raw)],
  [/^(?:select|activate|show|expand)\s+layer\s+(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^select\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'layerOn', target: clean(m[1]), raw })],
  [/^(?:undo|undo that|go back one step|reverse that|undo (?:the )?(?:basemap|background)(?: change)?|put the (?:basemap|background) back)[!.?]*$/i, (m, raw) => ({ name: 'undo', raw })],
  [/^(?:diagnostics|status|what do you know|brain status)[!.?]*$/i, (m, raw) => ({ name: 'diagnostics', raw })],
  // A guided tour of the app's tools, one stop at a time
  [/^(?:(?:give me|take me on|start|begin)\s+(?:a |the )?(?:quick |guided )?tour(?: of (?:this |the )?app)?|show me around(?: (?:this |the )?app)?|tour(?: (?:this |the )?app)?|walk me through (?:this |the )?app|what(?:'s|s| is) (?:in|on) (?:this|the) (?:app|page))[!.?]*$/i, (m, raw) => ({ name: 'tour', raw })],
  [/^(?:next(?: stop| one| tool| please)?|finish(?: the)? tour|continue(?: the)?(?: tour)?|keep going|go on|and then|what else|what(?:'s|s| is) next)[!.?]*$/i, (m, raw) => ({ name: 'tourNext', raw })],
  [/^(?:stop|end|quit|exit|skip)(?: the)? tour[!.?]*$|^(?:that's enough|enough|i'm good|im good)[!.?]*$/i, (m, raw) => ({ name: 'tourStop', raw })],
  // Run the last request once more (after a server hiccup, or just because)
  [/^(?:try (?:that |it )?again|retry(?: that)?|do (?:that|it) again|once more|again)[!.?]*$/i, (m, raw) => ({ name: 'tryAgain', raw })],
  // What Mappy has changed on the map this session
  [/^(?:what (?:did|have) (?:i|you|we) (?:change|changed|do|done)(?: so far| to the map| on the map)?|what changed|what(?:'s| is| has) (?:been )?changed|changes|history|show (?:my |the )?(?:changes|history))[!.?]*$/i, (m, raw) => ({ name: 'changes', raw })],
  // The whole picture in one answer
  [/^(?:what(?:'s|s| is) on the map(?: right now)?|what am i looking at|describe (?:the|this) map|summari[sz]e (?:the|this) map|map summary|what(?:'s|s| is) (?:showing|visible|turned on)(?: right now)?|overview)[!.?]*$/i, (m, raw) => ({ name: 'mapSummary', raw })],
  // Fewer interruptions
  [/^(?:fewer tips|less tips|no more tips|stop (?:the )?tips|turn off tips|no tips|quit (?:the )?tips|stop (?:bugging|interrupting|bothering) me|stop popping up|don'?t (?:bug|interrupt|bother) me|leave me be)[!.?]*$/i, (m, raw) => ({ name: 'fewerTips', raw })],
  // Copy or save the conversation
  [/^(?:copy (?:that|it|this|the answer|your answer|the last answer)|copy)[!.?]*$/i, (m, raw) => ({ name: 'copyAnswer', raw })],
  [/^(?:export|save|download)(?: (?:this|the|our))? (?:chat|conversation|transcript)|^(?:export|save|download) (?:this|the) (?:chat|conversation)(?: as (?:a )?(?:text|txt|file))?[!.?]*$/i, (m, raw) => ({ name: 'exportChat', raw })],
  // The feature under an open popup
  [/^(?:what (?:did i|did i just|have i) (?:click|clicked|select|selected|pick|picked)(?: on)?|what(?:'s|s| is) (?:this|that|selected|highlighted)(?: feature| thing| one)?|tell me about (?:this|that|the selected)(?: feature| one)?|about this(?: feature)?|details|more details|show (?:me )?(?:the )?details)[!.?]*$/i, (m, raw) => ({ name: 'clicked', raw })],
  [/^(?:commands|command guide|examples|what can you do|help|how does (?:this|it|mappy|the assistant) work|how do i use (?:this|it|you|mappy)|what do i do|how do i (?:get )?start(?:ed)?|instructions|tutorial)[!.?]*$/i, (m, raw) => ({ name: 'help', raw })],
  [/^(?:forget context|start over|new conversation)[!.?]*$/i, (m, raw) => ({ name: 'forget', raw })],
  [/^(?:zoom|go|fly) to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)[!?]*$/i, (m, raw) => ({ name: 'coordinates', target: m[1], value: m[2], raw })],
  [/^(?:make|set|turn)\s+(?:the\s+)?(.+?)\s+(?:(\d{1,3})\s*%\s*|half\s+|partly\s+|a\s+bit\s+|somewhat\s+)?(?:transparent|see[- ]through|faded|translucent)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: String(m[2] ? 100 - Number(m[2]) : 50), raw })],
  [/^(?:make|set|turn)\s+(?:the\s+)?(.+?)\s+(?:solid|opaque|fully visible|not transparent)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: '100', raw })],
  [/^fade(?: out)?\s+(?:the\s+)?(.+?)[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: '50', raw })],
  [/^(?:set )?scale(?: to)?\s+1\s*:\s*([\d,]+)[!.?]*$/i, (m, raw) => ({ name: 'scale', value: m[1].replace(/,/g, ''), raw })],
  [/^(?:set\s+)?(.+?)\s+(opacity|transparency)\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*%[!.?]*$/i, (m, raw) => ({ name: 'opacity', target: clean(m[1]), value: String(m[2].toLowerCase() === 'transparency' ? 100 - Number(m[3]) : Number(m[3])), raw })],
  [/^(hi|hello|hey|yo|sup|howdy|hiya|greetings|good (morning|afternoon|evening))\b[\s!.,?]*(mappy)?[\s!.?]*$/i, (m, raw) => ({ name: 'greet', raw })],
  [/^(thanks|thank you|thx|ty|cheers|nice|great|awesome|cool|perfect)\b|^(?:ok|okay|got it|alright|sounds good|cool),?\s+(?:thanks|thank you|thx|ty)\b/i, (m, raw) => ({ name: 'thanks', raw })],
  [/^(?:i\s+(?:love|like|adore)\s+(?:you|u|mappy)|love (?:you|u|ya)|you(?:'re| are)\s+(?:the best|awesome|amazing|great|my (?:bff|best friend|buddy|pal)|so (?:smart|helpful|cute))|(?:good|great|nice)\s+(?:job|work|boy|one)|best friend|bff|high five|hug|you rock)\b/i, (m, raw) => ({ name: 'thanks', raw })],
  [/^(who|what) are you\b|^what('?s| is) your name|^are you (a |an )?(bot|ai|robot|human)/i, (m, raw) => ({ name: 'whoami', raw })],
  [/^(help|\?|commands|what can (you|i) (do|ask)|how do (i|you) use (you|this|mappy)|what do you do)\b/i, (m, raw) => ({ name: 'help', raw })],
  [/\b(tell me )?(a )?(joke|pun|make me laugh|something funny)\b/i, (m, raw) => ({ name: 'joke', raw })],
  [/^(go away|go away for (?:now|a (?:bit|while|minute|sec))|bye|goodbye|bye bye|see ya|see you|later|hide|hide yourself|go hide|sleep|go to sleep|nap|take a nap|shh+|be quiet|quiet|shut up|close (?:the )?(?:chat|window|yourself)|dismiss|leave me alone|not now|that'?s all|i'?m done|im done|done|exit|minimize)[\s!.]*(mappy)?[\s!.]*$/i, (m, raw) => ({ name: 'sleep', raw })],
  [/^(tip|give me a tip|surprise me|random tip|did you know)\b/i, (m, raw) => ({ name: 'tip', raw })],
  [/^(clear|remove|reset)\s+(the\s+)?(highlights?|selection|results|graphics|search)\b/i, (m, raw) => ({ name: 'clear', raw })],
  [/^(what is|what's|tell me about|about|explain)\s+(this|the) (app|site|application|experience|page|map viewer)\b|^about$/i, (m, raw) => ({ name: 'about', raw })],

  // Map words people say instead of tool names
  [/^(?:what does (?:the |this |that )?(?:\w+ )?(?:line|lines|area|areas|dot|dots|dashed line|outline|shading|hatching|color|colou?r|symbol|icon|marker|fill|pattern) mean|what(?:'s|s| is) (?:the |this |that )?(?:\w+ )?(?:line|area|dot|outline|shading|symbol|marker)(?: on the map)?|what is the legend for .+)[?.!]*$/i, (m, raw) => ({ name: 'open', target: 'legend', raw })],
  [/^(?:nothing (?:is )?(?:on|showing|showing on|showing up on|drawing on)(?: the map)?|the map is (?:blank|empty|white|gray|grey|loading|not loading)|i (?:don'?t|can'?t) see (?:anything|any layers|the layers|the map)|no layers (?:are )?(?:showing|on)|why is the map (?:blank|empty)|where is everything|where did everything go|what is (?:on|showing on) the map|what is showing|what layers? (?:is|are) showing)[?.!]*$/i, (m, raw) => ({ name: 'mapBlank', raw })],
  [/^(?:(?:the\s+)?(.+?)\s+(?:layer\s+)?(?:is|isn'?t|is not|won'?t|doesn'?t|does not|aren'?t|are not|do not|don'?t)\s+(?:showing|show|showing up|visible|drawing|draw|appear|appearing|display|displaying|working|there|on the map|loading|load)(?: up)?|i (?:can'?t|cannot|don'?t) see (?:the\s+)?(.+?)(?:\s+layer)?(?:\s+on the map)?|where did (?:the\s+)?(.+?)(?:\s+layer)? go|why (?:is|isn'?t|are|aren'?t|did|does|doesn'?t|won'?t|can'?t)\s+(?:i see\s+)?(?:the\s+)?(.+?)(?:\s+layer)?\s*(?:not\s+)?(?:showing|show|visible|drawing|draw|appear|appearing|display|there|disappear|gone|missing|hidden|load)(?: up| when i zoom(?:ed)? (?:in|out))?)[?.!]*$/i, (m, raw) => /^(?:what|which|who|where|why|how|this|it|that|something|anything|nothing)\b/i.test(clean(m[1])) ? null : ({ name: 'layerDiagnosis', target: clean(m[1] || m[2] || m[3] || m[4]), raw })],
  [/^(?:(?:turn on|show|add|enable|display)\s+(?:the\s+)?labels?(?:\s+(?:for|on)\s+(?:the\s+)?(.+?))?|label\s+(?:the\s+)?(.+?))[?.!]*$/i, (m, raw) => ({ name: 'labels', target: clean(m[1] || m[2]) || undefined, value: 'on', raw })],
  [/^(?:(?:turn off|hide|remove|disable)\s+(?:the\s+)?labels?(?:\s+(?:for|on)\s+(?:the\s+)?(.+?))?|unlabel\s+(?:the\s+)?(.+?))[?.!]*$/i, (m, raw) => ({ name: 'labels', target: clean(m[1] || m[2]) || undefined, value: 'off', raw })],
  [/^(?:when|how (?:current|up to date|recent|old)|how often)\s+(?:is|was|are|were|does|do)\s+(?:the\s+|this\s+)?(.+?)(?:\s+(?:data|layer|imagery|photo|photos|aerials?))?\s+(?:updated|last updated|taken|flown|refreshed|edited|changed|collected|surveyed|current|maintained)[?.!]*$|^(?:who (?:maintains|keeps|made|created|publishes|is responsible for)|where (?:does|did)|what is the source of)\s+(?:the\s+|this\s+)?(.+?)(?:\s+(?:data|layer))?(?:\s+(?:come from|from))?[?.!]*$|^(?:is this (?:map|data) (?:accurate|current|up to date|reliable|official)|how accurate (?:is|are) (?:the\s+|this\s+)?(.+?)|what(?:'s|s| is) the (?:data )?source (?:of|for) (?:the\s+)?(.+?)|(?:map |data )?disclaimers?|(?:terms of use|accuracy|data accuracy)|can i use this map for a survey|is this a survey|are the parcel lines (?:exact|accurate|surveyed))[?.!]*$/i, (m, raw) => ({ name: 'dataInfo', target: clean(m[1] || m[2] || m[3] || m[4]) || 'this map', raw })],
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
  [/^(?:what(?:'s|s| is) the (?:map |current )?scale|(?:map |current )?scale\??|how zoomed in (?:am i|is (?:this|the map))|what zoom level)[?.!]*$/i, (m, raw) => ({ name: 'scaleInfo', raw })],
  [/^(?:go|take me|jump)\s+back(?:\s+(?:to (?:where i was|the (?:previous|last) (?:view|extent|place)|previous|last))?)?[?.!]*$|^(?:previous|last)\s+(?:view|extent)[?.!]*$|^back[?.!]*$/i, (m, raw) => ({ name: 'goBack', raw })],
  [/^(?:clear|reset|wipe)\s+(?:the\s+)?(?:map|screen|everything|all)(?:\s+(?:please|now))?[?.!]*$|^(?:start fresh|start over on the map|clean (?:the )?map)[?.!]*$/i, (m, raw) => ({ name: /reset/i.test(raw) ? 'resetMap' : 'clear', raw })],
  [/^(?:what|which)\s+(?:are the |are |is the )?(?:possible |available |valid |different |all the )?(.+?)\s+(?:types|kinds|values|codes|categories|classes|options|choices)(?:\s+(?:are there|exist|are available|can there be|do you have|are possible))?[?.!]*$|^(?:list|show(?: me)?)\s+(?:the\s+|all\s+)?(.+?)\s+(?:types|kinds|values|codes|categories|classes|options)[?.!]*$|^what (?:values|options) (?:can|does) (.+?) (?:have|take|be)[?.!]*$|^what (?:are|is) (?:the )?(?:possible |valid |allowed )?(?:values|options) (?:for|of|in) (.+?)[?.!]*$/i, (m, raw) => ({ name: 'values', target: clean(m[1] || m[2] || m[3] || m[4]), raw })],
  [/^(?:what|which)\s+(?:fields|columns|attributes|information|info|data|details)\s+(?:does|do|are (?:in|on)|is (?:in|on))\s+(?:the\s+)?(.+?)\s+(?:have|has|contain|include|hold)?[?.!]*$/i, (m, raw) => ({ name: 'fields', target: clean(m[1]).replace(/\s+(?:layer|table)$/i, ''), raw })],
  // Map navigation
  [/^(zoom|go|take me|fly)\s+(to\s+)?(?:the\s+)?(full|home|initial|start(ing)?|default|whole|everything|the whole (map|city|area))(\s+(?:extent|view|map))?\s*[!.?]*$/i, (m, raw) => ({ name: 'home', raw })],
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
  [/^(?:turn|switch|shut)\s+(?:off\s+)?(?:all|every|everything)(?:\s+(?:the\s+)?layers?)?\s*(?:off)?[?.!]*$|^(?:hide|clear)\s+(?:all|every)\s+(?:the\s+)?layers?[?.!]*$|^(?:all|everything|all layers) off[?.!]*$|^(?:hide|clear|remove) everything[?.!]*$/i, (m, raw) => ({ name: 'allOff', raw })],
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
  [/^(?:what(?:'s| is| are)?\s+(?:in|inside)|fields (?:in|of|for)|attributes (?:in|of|for)|columns (?:in|of|for)|describe(?: the)? layer|what (?:data|info|information|details|attributes|fields|columns) (?:is|are) (?:in|on|stored in|kept in))\s+(?:the\s+)?(.+?)(?:\s+layer)?[?.!]*$/i, (m, raw) => ({ name: 'fields', target: clean(m[1]), raw })],
  [/^(?:how many|count(?: the)?|number of)\s+(.+?)(?:\s+(?:are|is) (?:there|on the map|in view|visible|here))?(?:\s+(?:in total|altogether|overall|total|all together|in all))?[?.!]*$/i, (m, raw) => ({ name: 'count', target: clean(m[1]).replace(/\s+(?:in total|altogether|overall|total|all together|in all)$/i, ''), scope: /in view|visible|here|on screen/i.test(raw) ? 'view' : undefined, raw })],

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
  if (count && !/^(?:people|residents|folks|persons)\b/i.test(count[1])) return { name: 'count', target: clean(count[1]), scope: 'view', raw }
  for (const [rx, fn] of RULES) {
    const m = raw.match(rx)
    if (m) {
      const intent = fn(m, raw)
      if (intent && (intent.target === undefined || intent.target.length > 0)) return intent
    }
  }
  return { name: 'ask', target: raw, raw }
}
