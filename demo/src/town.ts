/*
  town.ts - Mapleton, a made-up town for trying Mappy. Every street, owner, parcel and hydrant
  here is invented; none of it is real data. Five layers, small enough to read at a glance and
  varied enough for real questions (who owns, how many, closest, by zoning, sold since).
*/
import { FakeLayer, Point, Polygon, Polyline } from './fakemap'
import type { FakeField } from './fakemap'

/** A small repeatable random number source, so the town is the same on every visit. */
function seeded (seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const AVENUES = [-100.018, -100.014, -100.010, -100.006, -100.002]
const AVENUE_NAMES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave']
const STREETS = [40.0105, 40.0075, 40.0045, 40.0015]
const STREET_NAMES = ['Maple St', 'Oak St', 'Birch St', 'Cedar St']
/** Blocks that are parks instead of lots: [column, row, name]. */
const PARKS: Array<[number, number, string]> = [[1, 0, 'Compass Park'], [3, 1, 'Legend Green'], [0, 2, 'Fold Field']]
/** Zoning by block column and row. The middle row is downtown. */
const zoneOf = (col: number, row: number): string => row === 1 ? (col >= 2 ? 'MU' : 'C-1') : col <= 1 ? 'R-4' : 'R-8'
const ZONE_NAMES: { [z: string]: string } = { 'R-4': 'Residential, 4 homes per acre', 'R-8': 'Residential, 8 homes per acre', 'C-1': 'Light Commercial', MU: 'Mixed Use' }
const OWNERS = ['Rivera', 'Okafor', 'Lindqvist', 'Nakamura', 'Delgado', 'Whitfield', 'Abara', 'Petrov', 'Castellanos', 'Brandt', 'Mill Creek LLC', 'Paper Trail Holdings', 'Fennimore', 'Osei', 'Harlow', 'Yoon', 'Quill & Compass Co', 'Maddox', 'Ibarra', 'Sandoval', 'Vance', 'Thackeray']
const MX = 85394; const MY = 111000
const acresOf = (w: number, h: number): number => Math.round(w * MX * h * MY / 4046.86 * 10) / 10
const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => new Polygon({ rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })
const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime()

export interface Town {
  layers: FakeLayer[]
  /** Addresses and named places for the locator. */
  places: Array<{ label: string, lon: number, lat: number }>
  start: { lon: number, lat: number, scale: number }
}

export function buildTown (): Town {
  const rand = seeded(20261117)
  const gap = 0.00016 // half a street width, in degrees
  const parcels: Array<{ attributes: any, geometry: any }> = []
  const parks: Array<{ attributes: any, geometry: any }> = []
  const zoning = new Map<string, number[][][]>()
  const places: Town['places'] = []
  let n = 0
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 3; row++) {
      const x0 = AVENUES[col] + gap; const x1 = AVENUES[col + 1] - gap
      const yTop = STREETS[row] - gap * 0.77; const yBot = STREETS[row + 1] + gap * 0.77
      const zone = zoneOf(col, row)
      const park = PARKS.find(p => p[0] === col && p[1] === row)
      if (park) {
        parks.push({ attributes: { NAME: park[2], ACRES: acresOf(x1 - x0, yTop - yBot), PLAYGROUND: park[2] !== 'Fold Field' ? 'Yes' : 'No', OPENED: 1950 + Math.floor(rand() * 60) }, geometry: rect(x0, yBot, x1, yTop) })
        places.push({ label: park[2], lon: (x0 + x1) / 2, lat: (yTop + yBot) / 2 })
      } else {
        // Each block is split into four lots, unevenly, so acreages differ.
        const sx = x0 + (x1 - x0) * (0.35 + rand() * 0.3)
        const sy = yBot + (yTop - yBot) * (0.35 + rand() * 0.3)
        const lots: Array<[number, number, number, number, string, number]> = [
          [x0, sy, sx, yTop, STREET_NAMES[row], 100 * (col + 1) + 10],
          [sx, sy, x1, yTop, STREET_NAMES[row], 100 * (col + 1) + 50],
          [x0, yBot, sx, sy, STREET_NAMES[row + 1], 100 * (col + 1) + 11],
          [sx, yBot, x1, sy, STREET_NAMES[row + 1], 100 * (col + 1) + 51]
        ]
        for (const [a, b, c, d, street, number] of lots) {
          n++
          const address = `${number} ${street}`
          const sold = day(2018 + Math.floor(rand() * 9), 1 + Math.floor(rand() * 12), 1 + Math.floor(rand() * 27))
          let owner = OWNERS[Math.floor(rand() * OWNERS.length)]
          let use = zone === 'C-1' ? 'Commercial' : zone === 'MU' ? (rand() < 0.5 ? 'Mixed Use' : 'Commercial') : 'Residential'
          // Two civic lots downtown, so "City Hall" and "the library" are real places to ask about.
          if (col === 1 && row === 1 && number === 250) { owner = 'Town of Mapleton'; use = 'Civic'; places.push({ label: 'City Hall', lon: (a + c) / 2, lat: (b + d) / 2 }) }
          if (col === 2 && row === 1 && number === 310) { owner = 'Town of Mapleton'; use = 'Civic'; places.push({ label: 'Mapleton Library', lon: (a + c) / 2, lat: (b + d) / 2 }) }
          parcels.push({ attributes: { PARCEL_NUM: `MP-${String(1000 + n)}`, ADDRESS: address, OWNER: owner, ACRES: acresOf(c - a, d - b), ZONING: zone, LAND_USE: use, YEAR_BUILT: use === 'Civic' ? 1931 : 1948 + Math.floor(rand() * 74), SALE_DATE: sold, ASSESSED_VALUE: Math.round((180 + rand() * 620)) * 1000, MAIL_ADDRESS: /LLC|Holdings|Co\b|Town of/.test(owner) ? `PO Box ${100 + n}` : address, MAIL_CITY: 'Mapleton' }, geometry: rect(a, b, c, d) })
          places.push({ label: address, lon: (a + c) / 2, lat: (b + d) / 2 })
        }
      }
      if (!zoning.has(zone)) zoning.set(zone, [])
      zoning.get(zone)!.push([[AVENUES[col], STREETS[row + 1]], [AVENUES[col + 1], STREETS[row + 1]], [AVENUES[col + 1], STREETS[row]], [AVENUES[col], STREETS[row]], [AVENUES[col], STREETS[row + 1]]])
    }
  }

  // One zoning record per block, so "count zoning by district" has something to count.
  const zoningRows: Array<{ attributes: any, geometry: any }> = []
  for (const [zone, rings] of zoning) for (const ring of rings) zoningRows.push({ attributes: { ZONE: zone, DESCRIPTION: ZONE_NAMES[zone], MAX_HEIGHT_FT: zone === 'MU' ? 65 : zone === 'C-1' ? 45 : 35 }, geometry: new Polygon({ rings: [ring] }) })

  const streets: Array<{ attributes: any, geometry: any }> = []
  STREETS.forEach((lat, i) => streets.push({ attributes: { NAME: STREET_NAMES[i], SURFACE: i === 3 ? 'Chip seal' : 'Asphalt', LANES: i === 1 ? 4 : 2, SPEED_LIMIT: i === 1 ? 30 : 25 }, geometry: new Polyline({ paths: [[[AVENUES[0], lat], [AVENUES[4], lat]]] }) }))
  AVENUES.forEach((lon, i) => streets.push({ attributes: { NAME: AVENUE_NAMES[i], SURFACE: 'Asphalt', LANES: i === 2 ? 4 : 2, SPEED_LIMIT: i === 2 ? 30 : 25 }, geometry: new Polyline({ paths: [[[lon, STREETS[0]], [lon, STREETS[3]]]] }) }))

  const hydrants: Array<{ attributes: any, geometry: any }> = []
  let h = 100
  STREETS.forEach((lat, r) => AVENUES.forEach((lon, c) => {
    if ((r + c) % 5 === 4) return
    h++
    const year = 1976 + Math.floor(rand() * 48)
    hydrants.push({ attributes: { FACILITYID: `H-${h}`, INSTALL_YEAR: year, STATUS: rand() < 0.12 ? 'Out of service' : 'Active', FLOW_GPM: 750 + Math.floor(rand() * 10) * 125, LAST_INSPECTED: day(2024 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 11), 1 + Math.floor(rand() * 27)) }, geometry: new Point({ x: lon + gap * 0.9, y: lat - gap * 0.7 }) })
  }))

  const text = (name: string, alias: string): FakeField => ({ name, alias, type: 'esriFieldTypeString' })
  const num = (name: string, alias: string, type = 'esriFieldTypeDouble'): FakeField => ({ name, alias, type })
  const date = (name: string, alias: string): FakeField => ({ name, alias, type: 'esriFieldTypeDate' })
  const oid: FakeField = { name: 'OBJECTID', alias: 'OBJECTID', type: 'esriFieldTypeOID' }

  const layers = [
    new FakeLayer('hydrants', 'Fire Hydrants', 'point', [oid, text('FACILITYID', 'Facility ID'), num('INSTALL_YEAR', 'Install Year', 'esriFieldTypeInteger'), text('STATUS', 'Status'), num('FLOW_GPM', 'Flow (GPM)', 'esriFieldTypeInteger'), date('LAST_INSPECTED', 'Last Inspected')], 'FACILITYID', hydrants, false, { fill: '#e0533f', stroke: '#8f2a1d' }),
    new FakeLayer('streets', 'Streets', 'polyline', [oid, text('NAME', 'Street Name'), text('SURFACE', 'Surface'), num('LANES', 'Lanes', 'esriFieldTypeInteger'), num('SPEED_LIMIT', 'Speed Limit', 'esriFieldTypeInteger')], 'NAME', streets, true, { stroke: '#ffffff' }),
    new FakeLayer('parks', 'Parks', 'polygon', [oid, text('NAME', 'Park Name'), num('ACRES', 'Acres'), text('PLAYGROUND', 'Playground'), num('OPENED', 'Year Opened', 'esriFieldTypeInteger')], 'NAME', parks, true, { fill: '#b9dba6', stroke: '#6aa84f' }),
    new FakeLayer('parcels', 'Parcels', 'polygon', [oid, text('PARCEL_NUM', 'Parcel Number'), text('ADDRESS', 'Address'), text('OWNER', 'Owner'), num('ACRES', 'Acres'), text('ZONING', 'Zoning'), text('LAND_USE', 'Land Use'), num('YEAR_BUILT', 'Year Built', 'esriFieldTypeInteger'), date('SALE_DATE', 'Sale Date'), num('ASSESSED_VALUE', 'Assessed Value', 'esriFieldTypeInteger'), text('MAIL_ADDRESS', 'Mailing Address'), text('MAIL_CITY', 'Mailing City')], 'ADDRESS', parcels, true, { fill: '#fdf7e3', stroke: '#b89b62' }),
    new FakeLayer('zoning', 'Zoning', 'polygon', [oid, text('ZONE', 'Zone'), text('DESCRIPTION', 'Description'), num('MAX_HEIGHT_FT', 'Max Height (ft)', 'esriFieldTypeInteger')], 'ZONE', zoningRows, false, { by: 'ZONE', colors: { 'R-4': '#f6e58d', 'R-8': '#f0b46a', 'C-1': '#e98a8a', MU: '#b79be0' }, stroke: '#7a5c2e' })
  ]
  return { layers, places, start: { lon: -100.010, lat: 40.006, scale: 7200 } }
}
