/*
  pretend-claude.ts - a stand-in for "Claude on the GIS server" so the demo can show what that
  feels like without calling any AI. It answers a handful of question shapes by actually
  querying the made-up town's layers, and says plainly that it is a simulation. In a real app
  this is the gis-mcp server's ask_assistant tool, where Claude does the reading and reasoning.
*/
import type { FakeLayer } from './fakemap'

export const DEMO_NOTE = 'Demo: this answer was put together in your browser to show how an AI answer looks. No AI was called.'

interface Port { label: string, fallback: boolean, prefs: any[], tools: () => Promise<any[]>, call: (name: string, args: any, timeout?: number) => Promise<any> }

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const ok = (answer: string, extra: any = {}): any => ({ content: [{ type: 'text', text: answer }], structuredContent: { answer, assistant: 'Claude (demo)', tools_used: [], followups: [], map: [], ...extra }, isError: false })

export function pretendClaude (layers: FakeLayer[], places: Array<{ label: string, lon: number, lat: number }>): Port {
  const layer = (id: string): FakeLayer => layers.find(l => l.id === id)!
  const ratings: Array<{ helpful: boolean, question: string }> = []
  const answer = async (q: string, context: string): Promise<any> => {
    const t = q.toLowerCase()
    const parcels = layer('parcels'); const hydrants = layer('hydrants'); const parks = layer('parks')
    const spanish = /[¿¡]|cu[aá]ntos|parques|d[oó]nde|qu[eé]\b/.test(t)

    if (spanish) {
      const names = parks.features.map(f => f.attributes.NAME)
      return ok(`Mapleton tiene **${names.length} parques**: ${names.join(', ')}. El más grande es **${[...parks.features].sort((a, b) => b.attributes.ACRES - a.attributes.ACRES)[0].attributes.NAME}**. Esto viene de la capa **Parks**.`, { tools_used: ['query_layer'], followups: ['¿Cuál tiene área de juegos?', '¿Cuántos hidrantes hay?'], map: [{ type: 'layer', layer: 'Parks' }] })
    }
    if (/zon/.test(t) && /(most|count|how many|each|by|per|breakdown|which)/.test(t)) {
      const by = new Map<string, number>()
      for (const f of parcels.features) by.set(f.attributes.ZONING, (by.get(f.attributes.ZONING) || 0) + 1)
      const rows = Array.from(by, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
      return ok(`**${rows[0].label}** has the most parcels, with **${rows[0].value}**. ${rows[1].label} is next with ${rows[1].value}. This is from the **Parcels** layer, grouped by zoning.`, {
        tools_used: ['describe_layer', 'query_layer'], chart: { title: 'Parcels by zoning', unit: 'parcels', rows },
        followups: [`Which ${rows[0].label} parcels are over 3 acres?`, 'What does MU zoning mean?'], map: [{ type: 'layer', layer: 'Zoning' }, { type: 'command', command: 'chart parcels by zoning', label: 'Chart it from the map' }]
      })
    }
    if (/(old|oldest|before|replace|age)/.test(t) && /hydrant/.test(t)) {
      const sorted = [...hydrants.features].sort((a, b) => a.attributes.INSTALL_YEAR - b.attributes.INSTALL_YEAR)
      const old = sorted.filter(f => f.attributes.INSTALL_YEAR < 1990)
      const first = sorted[0]
      return ok(`**${old.length} of ${hydrants.features.length}** hydrants were installed before 1990. The oldest is **${first.attributes.FACILITYID}**, from ${first.attributes.INSTALL_YEAR}. This is from the **Fire Hydrants** layer.`, {
        tools_used: ['query_layer'], table: { columns: ['Hydrant', 'Installed', 'Status'], rows: sorted.slice(0, 6).map(f => [f.attributes.FACILITYID, String(f.attributes.INSTALL_YEAR), f.attributes.STATUS]) },
        followups: ['Which hydrants are out of service?', 'Show them on the map'], map: [{ type: 'place', latitude: first.geometry.y, longitude: first.geometry.x, label: first.attributes.FACILITYID }, { type: 'layer', layer: 'Fire Hydrants' }]
      })
    }
    if (/out of service|broken|not working/.test(t)) {
      const out = hydrants.features.filter(f => f.attributes.STATUS !== 'Active')
      return ok(out.length ? `**${out.length}** hydrant${out.length === 1 ? ' is' : 's are'} out of service: ${out.map(f => f.attributes.FACILITYID).join(', ')}.` : 'Every hydrant is marked Active right now.', { tools_used: ['query_layer'], map: [{ type: 'command', command: 'only show fire hydrants where status is Out of service on the map', label: 'Show only those' }], followups: ['When were they last inspected?'] })
    }
    if (/(biggest|largest|most land|owns the most)/.test(t)) {
      const by = new Map<string, number>()
      for (const f of parcels.features) by.set(f.attributes.OWNER, (by.get(f.attributes.OWNER) || 0) + f.attributes.ACRES)
      const rows = Array.from(by, ([label, value]) => ({ label, value: Math.round(value * 10) / 10 })).sort((a, b) => b.value - a.value).slice(0, 5)
      return ok(`**${rows[0].label}** holds the most land, about **${rows[0].value} acres** across the Parcels layer.`, { tools_used: ['query_layer'], chart: { title: 'Acres by owner (top 5)', unit: 'acres', rows }, followups: [`List parcels owned by ${rows[0].label}`] })
    }
    if (/(what does|what is|meaning|mean|explain|difference)/.test(t) && /(mu|mixed|zon|r-4|r-8|c-1)/.test(t)) {
      return ok('In Mapleton, **MU (Mixed Use)** allows homes and shops in the same building, up to 65 feet tall. **C-1** is light commercial (45 feet), and **R-4** and **R-8** are residential at four and eight homes per acre. This is from the **Zoning** layer. For what can be built on a specific lot, the planning office has the final word.', { tools_used: ['describe_layer', 'query_layer'], map: [{ type: 'layer', layer: 'Zoning' }], followups: ['Which zoning district has the most parcels?', 'Where is MU zoning?'] })
    }
    if (/(print|pdf|export|how do i|how can i)/.test(t)) {
      const help = (context.match(/From this app's own help: ([^)]+)\)/) || [])[1]
      return ok(help ? `Here is what this app's help says: ${help.split(' | ')[0]}` : 'This demo has no Print tool, but in a real app I would point you to it and walk you through the steps from the app\'s own help.', { followups: ['What can you do?'] })
    }
    if (/(change|edit|update|delete|rezone|set the zoning)/.test(t)) {
      return ok('I can only read the map data, so I cannot change that. The GIS team can help with edits.', { followups: ['What zoning is 250 Oak St?'] })
    }
    if (/(look|see|picture|looking at)/.test(t)) {
      const on = layers.filter(l => l.visible).map(l => l.title)
      return ok(`You are looking at Mapleton with ${on.join(', ')} turned on. In a real app, with "Send a picture of the map" on, I would describe what is actually on screen.`, { followups: ['Which zoning district has the most parcels?'] })
    }
    const sold = parcels.features.filter(f => new Date(f.attributes.SALE_DATE).getFullYear() >= 2025).length
    return ok(`Here is Mapleton in numbers: **${parcels.features.length} parcels**, **${hydrants.features.length} fire hydrants**, **${parks.features.length} parks** and ${places.length} addresses. ${sold} parcels have sold since 2025. A real AI would answer your exact question; this demo knows a few (try the suggestions).`, { tools_used: ['list_layers', 'query_layer'], followups: ['Which zoning district has the most parcels?', 'How many hydrants were installed before 1990?', 'Who owns the most land?'] })
  }

  return {
    label: 'Mapleton GIS (demo)',
    fallback: true,
    prefs: [],
    tools: async () => [
      { name: 'ask_assistant', description: 'Ask the assistant a question in plain words.', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }, annotations: { readOnlyHint: true } },
      { name: 'assistant_feedback', description: 'Rate an answer.', inputSchema: { type: 'object', properties: { question: { type: 'string' }, helpful: { type: 'boolean' } } } }
    ],
    call: async (name: string, args: any) => {
      if (name === 'assistant_feedback') { ratings.push({ helpful: !!args?.helpful, question: String(args?.question || '') }); return { content: [{ type: 'text', text: 'Thank you. Noted.' }], structuredContent: { saved: true }, isError: false } }
      if (name !== 'ask_assistant') return { content: [{ type: 'text', text: 'The demo server has no such tool.' }], isError: true }
      // A real answer takes a few seconds while Claude looks things up; long enough to see him on the radio.
      await wait(1900 + Math.random() * 900)
      return answer(String(args?.question || ''), String(args?.context || ''))
    }
  }
}
