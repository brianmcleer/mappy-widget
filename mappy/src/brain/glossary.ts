/*
  glossary.ts - plain-language meanings for the words on a city map (parcel, easement,
  floodplain, right-of-way, hydrant, manhole, basemap...), what a zoning-style code looks
  like, and the questions a map cannot answer (office hours, bills, the weather) with a
  friendly pointer instead of "I couldn't find anything". Pure TypeScript, no lookups.
*/

export interface Term { term: string, aliases?: string[], text: string, see?: string[] }

/** Everyday words first, then the GIS ones. Each definition is one or two plain sentences. */
export const GLOSSARY: Term[] = [
  // Property
  { term: 'parcel', aliases: ['lot', 'property', 'tax lot', 'tax parcel'], text: 'A piece of land with its own owner and tax record. On the map each parcel is an outlined shape with a parcel number, owner and address.', see: ['parcel number', 'legal description'] },
  { term: 'parcel number', aliases: ['parcel id', 'apn', 'pin', 'schedule number', 'account number', 'tax id'], text: 'The number the county assessor uses for a parcel, such as 2945-144-01-014. It is the surest way to look a property up, because addresses change and numbers do not.' },
  { term: 'legal description', aliases: ['legal'], text: 'The formal wording that defines where a parcel is, usually by lot and block in a subdivision or by section, township and range. It is what deeds and plats use, not the street address.' },
  { term: 'owner', aliases: ['owner of record', 'ownership'], text: 'The person or organization the county assessor lists as owning a parcel. The map shows the assessor\'s record; recent sales can take a few weeks to appear.' },
  { term: 'situs', aliases: ['situs address', 'site address'], text: 'The street address of the property itself, as opposed to the mailing address where the owner gets letters.' },
  { term: 'assessed value', aliases: ['actual value', 'market value', 'valuation'], text: 'The value the county assessor puts on a property for taxes. The assessor sets it; the map only shows it.' },
  { term: 'subdivision', aliases: ['plat', 'platted', 'subdivision plat'], text: 'Land that was divided into lots, streets and open space under one recorded plan called a plat. The plat is the drawing; the subdivision is the neighborhood it created.' },
  { term: 'easement', aliases: ['easements'], text: 'A right for someone else to use part of a property for a set purpose, such as a utility line, a drainage ditch or access to a neighbor. The owner keeps the land but usually cannot put permanent structures on the easement.' },
  { term: 'right of way', aliases: ['right-of-way', 'row', 'public right of way'], text: 'The strip of land a street sits in, usually wider than the pavement, that the public has the right to use. Sidewalks, utilities and street trees often sit inside it.' },
  { term: 'setback', aliases: ['setbacks'], text: 'The minimum distance a building must keep from a property line, street or waterway. Setbacks come from the zoning code, so they depend on the zone a property is in.' },
  { term: 'annexation', aliases: ['annexed', 'annex'], text: 'Bringing land that was in the county into the city. After annexation the city provides services such as police, streets and planning, and the city\'s zoning applies.' },
  { term: 'city limits', aliases: ['city boundary', 'municipal boundary', 'incorporated'], text: 'The edge of the city. Inside it, the city provides services and its rules apply; outside it, the county does. The line is uneven because the city grew by annexing pieces of land over time.' },
  { term: 'adu', aliases: ['accessory dwelling unit', 'accessory dwelling', 'granny flat', 'casita'], text: 'A second, smaller home on the same lot as a main house, such as a backyard cottage or a garage apartment. Whether one is allowed depends on the zoning of the lot.' },
  // Planning
  { term: 'zoning', aliases: ['zone', 'zoning district', 'zoned', 'zoning code', 'zoning codes', 'zone code', 'zone codes', 'zoning map'], text: 'The rules for what can be built and done on a piece of land. Every property is in a zone (residential, commercial, industrial, mixed use and others), and the zone sets things like allowed uses, building height and setbacks.', see: ['overlay', 'setback'] },
  { term: 'overlay', aliases: ['overlay district', 'overlay zone'], text: 'An extra set of rules laid over the regular zoning in a certain area, such as a historic district, an airport zone or a floodplain overlay. A property can be in a zone and an overlay at the same time.' },
  { term: 'planned development', aliases: ['pd', 'pud', 'planned unit development'], text: 'A zone where the rules were written for one specific project instead of using a standard zone. The approved plan for that development spells out what is allowed.' },
  { term: 'land use', aliases: ['future land use', 'comprehensive plan', 'comp plan'], text: 'What land is used for now (homes, shops, farms) or what the city\'s long-range plan intends for it. Land use is the plan; zoning is the rule that puts the plan into practice.' },
  { term: 'variance', aliases: ['variances'], text: 'Permission to break a specific zoning rule, such as a setback, when the rule would cause a real hardship on that lot. It is granted case by case.' },
  { term: 'conditional use', aliases: ['conditional use permit', 'cup', 'special use'], text: 'A use that a zone allows only with a review and approval, with conditions attached, because it could affect the neighbors, such as a school or a church in a residential zone.' },
  { term: 'building permit', aliases: ['permit', 'permits'], text: 'The city\'s approval to build, add on, or do major electrical, plumbing or mechanical work. The map can tell you the zoning of a property; the building department decides what needs a permit.' },
  // Water
  { term: 'floodplain', aliases: ['flood plain', 'flood zone', 'special flood hazard area', 'sfha', '100 year floodplain', '100-year floodplain'], text: 'Land that FEMA expects to flood in a big storm. The "100-year" floodplain (zones starting with A or V) has a 1% chance of flooding in any year; building there needs extra steps and usually flood insurance. Zone X is outside it.', see: ['floodway', 'fema zone'] },
  { term: 'floodway', aliases: ['regulatory floodway'], text: 'The channel of a river plus the land beside it that must stay open to carry flood water. It is the most restricted part of the floodplain; almost nothing can be built in it.' },
  { term: 'FEMA zone', aliases: ['flood zone code', 'fema flood zone', 'flood zone letters'], text: 'FEMA\'s label for flood risk. A, AE, AO, AH and V are the high-risk floodplain (AE means a base flood elevation has been worked out). Shaded X is moderate risk (the "500-year" floodplain). Plain X is minimal risk.' },
  { term: 'base flood elevation', aliases: ['bfe'], text: 'The height flood water is expected to reach in the 1%-chance flood. Buildings in the floodplain must sit at or above it.' },
  { term: 'watershed', aliases: ['drainage basin', 'catchment'], text: 'All the land that drains to one stream, river or lake. Rain that falls anywhere in a watershed ends up at the same low point.' },
  { term: 'storm drain', aliases: ['storm sewer', 'stormwater', 'storm water', 'inlet', 'catch basin', 'culvert', 'detention pond', 'retention pond'], text: 'The system that carries rain off streets and roofs: inlets and catch basins at the curb, pipes underneath, culverts under roads, and ponds that hold water back. It is separate from the sanitary sewer that carries wastewater.' },
  { term: 'sanitary sewer', aliases: ['sewer', 'sewer main', 'sewer line', 'wastewater'], text: 'The pipes that carry wastewater from sinks, toilets and drains to the treatment plant. Mains run under the street; a lateral connects each building to the main.', see: ['lateral', 'manhole'] },
  { term: 'lateral', aliases: ['sewer lateral', 'service line', 'service lateral'], text: 'The pipe from one building to the main in the street. The property owner usually owns and maintains the lateral up to the main.' },
  { term: 'manhole', aliases: ['manholes', 'maintenance hole'], text: 'An access point into an underground pipe, with a round lid in the street. Crews use it to inspect and clean sewer and storm lines.' },
  { term: 'water main', aliases: ['main', 'mains', 'water line', 'distribution main'], text: 'The large pipe under the street that carries drinking water through a neighborhood. Service lines branch off it to each building.' },
  { term: 'hydrant', aliases: ['fire hydrant', 'hydrants'], text: 'The connection where fire crews draw water from the water main. Hydrants are tested for flow and pressure, which is why the map may show test dates and flow rates.' },
  { term: 'valve', aliases: ['water valve', 'system valve', 'gate valve'], text: 'A shutoff on a water main. Crews close valves to isolate a section for repairs, so a water outage usually follows the valves around a break.' },
  { term: 'irrigation', aliases: ['irrigation ditch', 'canal', 'ditch', 'lateral ditch'], text: 'Water carried in canals and ditches to water land, separate from drinking water. In the valley, many neighborhoods still get irrigation water from a ditch company in summer.' },
  { term: 'water district', aliases: ['water provider', 'sanitation district', 'sewer district', 'special district', 'metro district'], text: 'The organization that provides a service in an area, such as drinking water or sewer. Districts have their own boundaries, which is why neighbors can have different providers.' },
  // Streets and civic
  { term: 'council district', aliases: ['city council district', 'ward', 'district'], text: 'The area a city council seat is tied to. The map can tell you which district an address is in and which council member holds that seat.' },
  { term: 'precinct', aliases: ['voting precinct', 'polling place'], text: 'The area assigned to one polling location for elections. Precinct boundaries come from the county clerk.' },
  { term: 'school attendance area', aliases: ['school boundary', 'attendance area', 'attendance boundary', 'school zone'], text: 'The area whose students go to a particular school. The school district draws these lines, and they can change.' },
  { term: 'address point', aliases: ['address points', 'site address point'], text: 'A dot on the map placed where an address is, usually on the building. Address points are what address searches snap to.' },
  { term: 'centerline', aliases: ['street centerline', 'road centerline'], text: 'A line down the middle of each street, carrying the street name and address ranges. It is what routing and address searches are built on.' },
  { term: 'trail', aliases: ['trails', 'multi-use path', 'bike path'], text: 'A path for walking and biking, separate from the street. The trails layer usually shows the surface (paved or dirt) and who maintains it.' },
  { term: 'park', aliases: ['parks', 'open space'], text: 'Public land for recreation. Open space is land kept natural; a park has facilities such as fields, playgrounds and restrooms.' },
  { term: 'trash pickup day', aliases: ['trash day', 'garbage day', 'pickup day', 'collection day', 'recycling day'], text: 'The weekday trash (and recycling) is collected on a street. When the map has a pickup-day layer, ask "when is trash pickup at <address>".' },
  // Map words
  { term: 'layer', aliases: ['layers', 'map layer'], text: 'One set of features drawn on the map, such as parcels, hydrants or zoning. Layers stack on top of each other, and you can turn each one on or off.' },
  { term: 'feature', aliases: ['features'], text: 'One thing in a layer: one parcel, one hydrant, one street segment. Each feature has a shape on the map and a row of information (its attributes).' },
  { term: 'attribute', aliases: ['attributes', 'field', 'fields', 'column'], text: 'A piece of information about a feature, such as a parcel\'s owner or a hydrant\'s install date. The attribute table lists every feature with all its fields.' },
  { term: 'popup', aliases: ['pop-up', 'pop up', 'info window'], text: 'The small window that opens when you click a feature on the map, showing its attributes.' },
  { term: 'basemap', aliases: ['base map', 'background map'], text: 'The background underneath the layers: streets, aerial imagery, topographic or a plain gray canvas. Changing it changes only the background, not the data on top.' },
  { term: 'aerial imagery', aliases: ['imagery', 'aerial', 'aerials', 'orthophoto', 'ortho', 'satellite', 'satellite view'], text: 'Photos of the ground taken from a plane or satellite and fitted to the map. They show what was there on the day of the flight, so new buildings can be missing.' },
  { term: 'legend', aliases: ['key', 'map key', 'symbols'], text: 'The list that explains what each color and symbol on the map means. Open the Legend tool to see it for the layers that are on.' },
  { term: 'scale', aliases: ['map scale', 'scale bar'], text: 'How zoomed in the map is, written as a ratio: at 1:10,000 one inch on the screen is 10,000 inches (about 830 feet) on the ground. A smaller number means more zoomed in. Some layers only draw within a range of scales.' },
  { term: 'extent', aliases: ['map extent', 'view extent', 'current view'], text: 'The rectangle of the world the map is showing right now. "In view" or "in the current extent" means inside that rectangle.' },
  { term: 'bookmark', aliases: ['bookmarks', 'saved view'], text: 'A saved map view you can jump back to, such as "Downtown". Bookmarks are set up by whoever built the map.' },
  { term: 'coordinates', aliases: ['latitude', 'longitude', 'lat long', 'lat/long', 'lat lon', 'xy', 'x y'], text: 'A location written as two numbers. Latitude (north-south, about 39 here) and longitude (east-west, about -108 here) are the common pair; the map may also use a local x, y in feet or meters.' },
  { term: 'projection', aliases: ['coordinate system', 'spatial reference', 'wkid', 'state plane', 'web mercator', 'utm'], text: 'The math that flattens the round Earth onto a flat map. Web maps use Web Mercator; surveys around here often use Colorado State Plane. Each has an id number (a WKID).' },
  { term: 'buffer', aliases: ['buffer zone', 'radius'], text: 'The area within a set distance of something, such as everything within 500 feet of an address. Asking "what is within 500 ft of ..." uses a buffer.' },
  { term: 'geocode', aliases: ['geocoding', 'address locator', 'locator'], text: 'Turning an address into a spot on the map. The locator matches the words you typed against the city\'s address points and streets and gives a score for how sure it is.' },
  { term: 'reverse geocode', aliases: ['reverse geocoding'], text: 'The opposite of geocoding: starting from a spot on the map and finding the nearest address.' },
  { term: 'identify', aliases: ['identify tool', 'what is here'], text: 'Clicking a spot to see every feature there: the parcel, its zoning, the flood zone, the council district and so on. Asking "what is at <address>" does the same thing.' },
  { term: 'select', aliases: ['selection', 'selected features'], text: 'Marking features on the map so a tool can work on just those, such as exporting them or viewing them in the table. Selected features are usually highlighted in cyan.' },
  { term: 'query', aliases: ['filter', 'where clause', 'definition query'], text: 'Asking for only the features that match a rule, such as parcels where acres is greater than 5. Mappy builds the query when you ask in plain words.' },
  { term: 'attribute table', aliases: ['table', 'data table', 'records'], text: 'A spreadsheet-like view of a layer: one row per feature, one column per field. Ask "open <layer> in the table".' },
  { term: 'shapefile', aliases: ['shp', 'geodatabase', 'gdb', 'feature class', 'geojson', 'kml', 'kmz'], text: 'File formats for map data. A shapefile is an old, common one (several files that travel together); a geodatabase holds many layers in one place; GeoJSON and KML are text formats web tools and Google Earth read.' },
  { term: 'feature service', aliases: ['map service', 'rest service', 'arcgis server', 'service url'], text: 'A web address that serves a layer\'s data to maps and apps. Everything on this map comes from services like these, which is why the data stays current without downloading anything.' },
  { term: 'web map', aliases: ['webmap'], text: 'A saved map, with its layers, symbols and starting view, that apps like this one open. The map you see here is a web map.' },
  { term: 'gis', aliases: ['g.i.s.', 'geographic information system'], text: 'Geographic Information System: software and data for making maps and answering "where" questions. The City\'s GIS Division keeps the layers on this map.' },
  { term: 'lidar', aliases: ['elevation', 'dem', 'contour', 'contours', 'contour lines', 'topo', 'topographic'], text: 'Ways of showing the shape of the ground. Contour lines connect points of equal elevation (close lines mean steep ground); a DEM is a grid of elevations; lidar is the laser survey many DEMs are made from.' },
  { term: 'metadata', text: 'Information about the data itself: where it came from, when it was updated, what each field means and how accurate it is. Ask "tell me about the <layer> layer".' },
  { term: 'mcp server', aliases: ['mcp', 'model context protocol'], text: 'A small service Mappy can ask questions of, such as the City GIS server that answers "who owns ..." and "closest hydrant to ...". It is set up by the app author.' }
]

const TERM_INDEX = new Map<string, Term>()
for (const t of GLOSSARY) for (const k of [t.term, ...(t.aliases || [])]) TERM_INDEX.set(norm(k), t)

function norm (s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }

/** Terms from the knowledge feed. A built-in term keeps its meaning; new words are added. Returns how many were added. */
export function addTerms (terms: Term[]): number {
  let added = 0
  for (const t of terms || []) {
    if (!t?.term || !t.text) continue
    for (const k of [t.term, ...(t.aliases || [])]) {
      const n = norm(k)
      if (n && !TERM_INDEX.has(n)) { TERM_INDEX.set(n, t); added++ }
    }
  }
  return added
}

/** "parcels" -> "parcel", "easements" -> "easement" (keeps "address"). */
function singular (s: string): string { return s.replace(/(?<=[a-z]{3})s$/, m => s.endsWith('ss') ? m : '') }

/** The glossary entry for a word or phrase, if there is one. */
export function lookupTerm (phrase: string): Term | null {
  const n = norm(phrase)
  if (!n) return null
  return TERM_INDEX.get(n) || TERM_INDEX.get(singular(n)) || TERM_INDEX.get(n.replace(/^(?:a|an|the) /, '')) || TERM_INDEX.get(singular(n.replace(/^(?:a|an|the) /, ''))) || null
}

/** A zoning-style code: R-4, RM-8, C-1, MXG, PD, I-2, AE, X. */
export const CODE_SHAPE = /^[A-Z]{1,4}(?:-?\d{1,3})?[A-Z]?$/

/**
 * A definition question: "what is a parcel", "what does easement mean", "define floodplain",
 * "what is RM-8", "what does zone AE mean", "explain zoning". Returns the words asked about,
 * or null when the text is not asking for a meaning.
 */
export function definitionAsk (q: string): { phrase: string, code: boolean } | null {
  const t = q.trim().replace(/[?.!]+$/, '')
  const m = t.match(/^(?:what(?:'s| is| are| does|s)?\s+(?:a |an |the )?(.+?)(?:\s+(?:mean|stand for|means|refer to))?|define\s+(.+?)|definition of\s+(.+?)|(.+?)\s+(?:meaning|definition)|explain\s+(?:what\s+)?(?:a |an |the )?(.+?)(?:\s+(?:is|means|are))?|meaning of\s+(?:a |an |the )?(.+?)|what do you mean by\s+(.+?))$/i)
  if (!m) return null
  let phrase = (m[1] || m[2] || m[3] || m[4] || m[5] || m[6] || m[7] || '').trim()
  // "zone AE", "zoning code R-4", "R-4 zoning": the code is the question.
  const wrapped = phrase.match(/^(?:(?:zone|zoning|code|the code|zoning code|flood zone)\s+)?(\S+?)(?:\s+(?:zone|zoning|code|district))?$/i)
  if (wrapped && CODE_SHAPE.test(wrapped[1].toUpperCase()) && wrapped[1] !== phrase && !lookupTerm(phrase)) phrase = wrapped[1]
  if (!phrase || phrase.split(/\s+/).length > 5) return null
  // "what is here", "what is this", "what is on" are not definitions.
  if (/^(?:here|this|that|it|on|off|up|new|the time|today|your name|the weather|the scale|the map|this app|this map)$/i.test(phrase)) return null
  const upper = phrase.toUpperCase()
  const code = CODE_SHAPE.test(upper) && (/\d/.test(phrase) || phrase === upper) && phrase.length <= 6
  return { phrase, code: code && !lookupTerm(phrase) }
}

/** A plain reading of a zoning-style code when the map has no definition for it. */
export function codeGuess (code: string): string {
  const c = code.toUpperCase()
  const letters = (c.match(/^[A-Z]+/) || [''])[0]
  const num = (c.match(/\d+/) || [''])[0]
  const family: { [k: string]: string } = {
    R: 'residential', RR: 'rural residential', RE: 'residential estate', RM: 'residential, medium density', RH: 'residential, high density', RO: 'residential office', RS: 'residential', RL: 'residential, low density',
    C: 'commercial', CN: 'neighborhood commercial', CG: 'general commercial', CSR: 'commercial services and retail', B: 'business', O: 'office',
    I: 'industrial', IO: 'industrial office', M: 'industrial (manufacturing)', MU: 'mixed use', MX: 'mixed use', MXR: 'mixed use residential', MXG: 'mixed use general', MXOC: 'mixed use office commercial',
    PD: 'planned development', PUD: 'planned unit development', PAD: 'planned airport development', A: 'agricultural', AG: 'agricultural', AFT: 'agricultural, forestry and transitional', OS: 'open space', P: 'public', PF: 'public facilities', CI: 'civic', H: 'historic',
    AE: 'FEMA flood zone AE: the 1%-chance floodplain, with a base flood elevation set', AO: 'FEMA flood zone AO: shallow flooding, usually sheet flow', AH: 'FEMA flood zone AH: shallow ponding', VE: 'FEMA flood zone VE: coastal high hazard', X: 'FEMA flood zone X: outside the 1%-chance floodplain'
  }
  const kind = family[letters]
  if (!kind) return `${c} is a code on the map. Its exact meaning is set by whoever keeps that layer; the legend or the layer's description should spell it out.`
  if (letters === 'A' && !num) return `A is usually FEMA flood zone A (the 1%-chance floodplain, no base flood elevation worked out) or, on a zoning map, agricultural. Which layer did you see it on?`
  if (/^(?:AE|AO|AH|VE|X)$/.test(c)) return `${c} is ${kind}. FEMA sets flood zones; the flood zone layer's legend has the details.`
  const density = num && /^R/.test(letters) ? ` The ${num} is usually the most homes allowed per acre.` : num && /^[CBI]/.test(letters) ? ` The ${num} tells the zones of that kind apart; higher numbers usually allow more intense use.` : ''
  return `${c} usually means ${kind}.${density} The city's zoning code sets the exact rules, so check the zoning layer's legend or link for this one.`
}

export interface Aside { topic: string, text: string, suggest?: string[] }

/**
 * Things a map does not know, answered kindly with where to look, instead of "I found nothing".
 */
export function outOfScope (q: string, org = 'the City'): Aside | null {
  const t = q.trim().toLowerCase()
  /** "the City's website", "the County's website", "Example Water District's website". */
  const site = `${org}'s website`
  if (/\b(?:hours|opening hours|office hours|what time|is (?:it|the \w+) open|are (?:they|you) open|closed today|open today|open tomorrow|when does .+ (?:open|close))\b/.test(t) && !/\blayer\b/.test(t)) {
    return { topic: 'hours', text: `I only know the map, not office hours. ${site[0].toUpperCase() + site.slice(1)} lists hours for each office. I can show you where a place is on the map if that helps.`, suggest: ['Where is City Hall?'] }
  }
  if (/\b(?:council meeting|meeting agenda|agenda|minutes|public hearing|next meeting|board meeting|commission meeting)\b/.test(t)) {
    return { topic: 'meetings', text: `Meeting dates, agendas and minutes are on ${site}, not on this map. I can tell you which council district an address is in and who represents it.`, suggest: ['Which council district is my address in?'] }
  }
  if (/\b(?:weather|forecast|temperature|rain today|snow today|wind|air quality|smoke)\b/.test(t)) {
    return { topic: 'weather', text: 'I do not have the weather. I can tell you whether a place is in a flood zone, though, which is the map\'s kind of weather.', suggest: ['Is my address in a flood zone?'] }
  }
  if (/\b(?:pay|payment|bill|bills|invoice|late fee|balance due|account balance)\b/.test(t)) {
    return { topic: 'bills', text: `Bills and payments are handled on ${site} or by the utility that sends them, not on this map. I can tell you which water or sanitation district serves an address.`, suggest: ['What water district serves my address?'] }
  }
  if (/\b(?:taxes|tax bill|property tax|mill levy|how much (?:are|is) my (?:taxes|tax)|property worth|home worth|house worth|appraisal|appraised)\b/.test(t)) {
    return { topic: 'taxes', text: 'Tax amounts and appraisals come from the county assessor and treasurer, not this map. The parcel record here may show the assessed value: ask "tell me about <address>".', suggest: ['Tell me about my address'] }
  }
  if (/\b(?:do i need a permit|need a permit|permit required|can i build|am i allowed to|allowed to build|is it legal|can i have|how tall can|how many (?:dogs|chickens|cars)|short[- ]term rental|airbnb|run a business from)\b/.test(t)) {
    return { topic: 'rules', text: 'What is allowed on a property depends on its zone, and the planning and building departments make that call. I can tell you the zoning of any address, which is the first thing they will ask.', suggest: ['What is the zoning at my address?'] }
  }
  if (/\b(?:pothole|potholes|water leak|leak|leaking|streetlight|street light|light is out|graffiti|code violation|weeds|dead animal|water is off|no water|low pressure|sewer backup|backed up|clogged|flooding my|report (?:a |an )?(?:problem|issue|concern|hazard)|broken (?:sidewalk|sign|signal)|missed (?:trash|pickup)|trash (?:wasn'?t|was not) picked up|who do i call|who should i call|who do i contact about)\b/.test(t)) {
    return { topic: 'report', text: `That sounds like something to report to ${org}. Use the Report a Concern tool when this app has one, or ${site}; for a water or sewer emergency, call the utility\'s emergency line. I can show where things are on the map in the meantime.`, suggest: ['Closest hydrant to my address', 'What water district serves my address?'] }
  }
  if (/\b(?:zoning code|municipal code|city code|code of ordinances|ordinance|land development code|zoning ordinance)\b/.test(t) && /\b(?:where|find|read|link|copy|look up|see|get)\b/.test(t)) {
    return { topic: 'code', text: `The zoning code is published on ${site} (the online code library). When you ask me the zoning of an address, the answer includes a link to that zone\'s section when the layer has one.`, suggest: ['What is the zoning at my address?'] }
  }
  if (/\b(?:news|events?|festival|parade|concert|fireworks show|what'?s happening|things to do)\b/.test(t) && !/\bmap\b/.test(t)) {
    return { topic: 'events', text: `Events and news live on ${site} and social media. On the map I can find parks, trails and places by name.`, suggest: ['List the parks'] }
  }
  if (/\b(?:bus|transit|bus route|bus schedule|next bus|train|flight|airport flights)\b/.test(t) && !/\b(?:near|closest|nearest|within|stops? layer)\b/.test(t)) {
    return { topic: 'transit', text: 'Bus schedules come from the transit agency, not this map. If the map has a bus stops layer, I can find the closest stop to an address.', suggest: ['Closest bus stop to my address'] }
  }
  if (/\b(?:emergency|911|fire department phone|police phone|call the police|report a crime|crime rate|is it safe)\b/.test(t) && !/\b(?:map|layer|district|near|closest|nearest|within)\b/.test(t)) {
    return { topic: 'emergency', text: 'For an emergency call 911. I am just a map; I can show fire stations and police districts, but I cannot send anyone.', suggest: ['Closest fire station to my address'] }
  }
  return null
}
