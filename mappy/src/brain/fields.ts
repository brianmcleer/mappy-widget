/*
  fields.ts - what to call a field when Mappy shows it to people. The field's alias first, when
  the alias is a real label ("Parcel Number"); otherwise the field name made readable:
  PARCEL_NUM -> Parcel Number, OWNERNAME -> Owner Name, yearBuilt -> Year Built,
  SUBDIVISIO (cut short by a shapefile) -> Subdivision, Shape.STArea() -> Area,
  gjgis.DBO.Parcels.SITUS_ADDR -> Situs Address. Pure TypeScript, no lookups.
*/

/** Short forms in field names and what they stand for. */
const ABBR: { [k: string]: string } = {
  num: 'Number', nbr: 'Number', nmbr: 'Number', no: 'Number', addr: 'Address', adr: 'Address', desc: 'Description', descr: 'Description',
  cd: 'Code', typ: 'Type', stat: 'Status', sts: 'Status', dt: 'Date', yr: 'Year', qty: 'Quantity', amt: 'Amount', sqft: 'Sq Ft',
  diam: 'Diameter', dia: 'Diameter', matl: 'Material', mat: 'Material', elev: 'Elevation', lat: 'Latitude', lng: 'Longitude', lon: 'Longitude',
  jt: 'Joint', ownr: 'Owner', acct: 'Account', dept: 'Department', dist: 'District', inst: 'Install', instl: 'Install', insp: 'Inspection',
  maint: 'Maintenance', rd: 'Road', zn: 'Zone', fld: 'Flood', ph: 'Phone', tel: 'Phone', emerg: 'Emergency', ord: 'Ordinance',
  subdiv: 'Subdivision', bldg: 'Building', impr: 'Improvement', imprv: 'Improvement', val: 'Value', assd: 'Assessed', mkt: 'Market',
  nm: 'Name', pct: 'Percent', avg: 'Average', tot: 'Total', cnt: 'Count', seq: 'Sequence', rte: 'Route', wk: 'Week', mo: 'Month',
  hr: 'Hour', hh: 'Households', fac: 'Facility', facil: 'Facility', loc: 'Location', muni: 'Municipality', jur: 'Jurisdiction',
  juris: 'Jurisdiction', fid: 'FID', comm: 'Comments', cmt: 'Comment', cmts: 'Comments', mfr: 'Manufacturer', mfg: 'Manufacturer',
  inv: 'Invert', ups: 'Upstream', dns: 'Downstream', dnstr: 'Downstream', upstr: 'Upstream', ln: 'Line', ctr: 'Center',
  sz: 'Size', len: 'Length', wid: 'Width', ht: 'Height', depth: 'Depth', yb: 'Year Built', eff: 'Effective', act: 'Actual',
  mail: 'Mailing', st: 'St', apt: 'Apt', ste: 'Suite', strname: 'Street Name', stname: 'Street Name', stnum: 'Street Number',
  pdir: 'Prefix Direction', sdir: 'Suffix Direction', sfx: 'Suffix', pfx: 'Prefix', rec: 'Reception', recpt: 'Reception', plat: 'Plat',
  esmt: 'Easement', blt: 'Built', auth: 'Authority', bld: 'Built', ownrshp: 'Ownership', lgl: 'Legal', sub: 'Sub', twp: 'Township', rng: 'Range', sec: 'Section', row: 'ROW', lu: 'Land Use', luc: 'Land Use Code', ayb: 'Actual Year Built', eyb: 'Effective Year Built'
}

/** Words written in capitals. */
const ACRONYMS = new Set(['id', 'oid', 'fid', 'gis', 'pin', 'apn', 'fema', 'gps', 'uid', 'guid', 'url', 'zip', 'hoa', 'row', 'ne', 'nw', 'se', 'sw', 'usgs', 'utm', 'ada', 'gpm', 'psi', 'hp', 'kw', 'kv', 'pvc', 'dip', 'hdpe', 'rcp', 'cmp', 'vcp', 'abs', 'ac', 'ci', 'di', 'ftp', 'http', 'mh', 'cb', 'bmp', 'srid', 'wkid', 'sfha', 'firm', 'lomr', 'loma', 'cip', 'pud', 'nc', 'us', 'cr', 'hwy', 'cdot', 'nrcs', 'blm', 'usfs', 'pk', 'fk', 'pdf', 'jpg'])

/** Words fields are made of, for names written as one run ("OWNERNAME", "WATERDISTN"). */
const VOCAB = ('parcel parcels owner owners name names joint mailing mail address addresses street streets number city state zip county ' +
  'zone zoning district districts year built platted plat date dates type types status code codes school schools facility facilities ' +
  'sewer storm water main mains line lines size length width height area acres acre land use value values legal description subdivision ' +
  'reception lots lot drainage report file files route routes day days pickup recycling trash council rep representative elevation ' +
  'material diameter install installed condition inspection location last first full house unit suite phone email website web site notes note ' +
  'comment comments total count class effective actual assessed market improvement improvements building buildings account tax taxes ' +
  'authority pointer neighborhood ward precinct flood hazard panel census tract block group population household households income ' +
  'permit permits project projects module case cases inspection inspections work order orders asset assets feature features label labels ' +
  'start end begin from to up down stream upstream downstream invert depth slope pipe pipes valve valves hydrant hydrants manhole manholes ' +
  'meter meters service services station stations pump pumps tank tanks basin basins inlet inlets outfall culvert culverts ditch canal ' +
  'irrigation electric gas utility utilities provider company contact title first middle last suffix prefix direction directions dir ' +
  'center centre north south east west upper lower left right side road roads lane alley trail trails park parks open space boundary ' +
  'limits limit municipal municipality jurisdiction incorporated annexation annexed ordinance resolution overlay overlays historic ' +
  'landmark ownership deed book page source sources method accuracy quality editor edited created modified update updated version ' +
  'global unique identifier object shape geometry latitude longitude x y z elevation measure distance feet foot meters miles percent ' +
  'average minimum maximum min max sum mean median rank score priority risk rating grade level levels floor floors room rooms bed beds ' +
  'bath baths garage pool fence fences sign signs signal signals light lights pole poles tree trees species diameter canopy height crown ' +
  'photo photos image images link links document documents drawing drawings plan plans sheet sheets book date time hour minute second').split(/\s+/)
const WORDS = new Set(VOCAB)

function titleWord (w: string, first: boolean): string {
  const low = w.toLowerCase()
  if (ACRONYMS.has(low)) return low.toUpperCase()
  if (!first && /^(of|and|or|by|in|to|for|at|on|the|a|per)$/.test(low)) return low
  if (/^\d/.test(w)) return w
  return low.charAt(0).toUpperCase() + low.slice(1)
}

/** "ownername" -> ["owner", "name"]; null when the run is not made only of known words. */
function segment (run: string): string[] | null {
  const s = run.toLowerCase()
  if (s.length < 6 || WORDS.has(s)) return null
  const best: Array<string[] | null> = new Array(s.length + 1).fill(null)
  best[0] = []
  for (let i = 1; i <= s.length; i++) {
    for (let j = Math.max(0, i - 14); j < i; j++) {
      const piece = s.slice(j, i)
      const prev = best[j]
      if (!prev) continue
      // Known words anywhere; short forms ("jt", "yr", "id") too, as long as the whole run is covered.
      const ok = (WORDS.has(piece) && piece.length >= 2) || (piece.length >= 2 && (ABBR[piece] || ACRONYMS.has(piece)))
      if (!ok) continue
      const cand = [...prev, piece]
      // Fewest pieces wins; on a tie, the one with more real words.
      const real = (x: string[]) => x.filter(p => WORDS.has(p)).length
      if (!best[i] || cand.length < best[i]!.length || (cand.length === best[i]!.length && real(cand) > real(best[i]!))) best[i] = cand
    }
  }
  const out = best[s.length]
  return out && out.length > 1 ? out : null
}

/** A word cut short by a ten-letter shapefile name ("SUBDIVISIO", "DISTRICTIN" is not one). */
function finish (word: string): string {
  const w = word.toLowerCase()
  if (w.length < 5 || WORDS.has(w) || ABBR[w]) return word
  const hit = VOCAB.find(v => v.length > w.length && v.startsWith(w))
  return hit || word
}

/** A field name made readable: PARCEL_NUM -> "Parcel Number", yearBuilt -> "Year Built". */
export function humanizeName (name: string): string {
  let n = String(name || '').trim()
  if (!n) return ''
  if (/shape[._]*(st)?area|^st_area/i.test(n)) return 'Area'
  if (/shape[._]*(st)?len(gth)?|^st_length/i.test(n)) return 'Length'
  // "gjgis.DBO.Parcels.SITUS_ADDR": the last part is the field.
  if (/\./.test(n) && !/\(\)$/.test(n)) n = n.split('.').pop() || n
  const spaced = n
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)\s*(st|nd|rd|th)\b/gi, (m, d, o) => d + o.toLowerCase() + ' ')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
  const raw = spaced.split(' ').filter(Boolean)
  const words: string[] = []
  raw.forEach((t, i) => {
    const low = t.toLowerCase()
    // "no" is only "Number" at the end ("PARCEL_NO"), not in "NO_PARKING".
    if (low === 'no' && i !== raw.length - 1) { words.push(t); return }
    if (/^\d+(st|nd|rd|th)$/.test(low)) { words.push(low); return }
    if (ABBR[low] && !(low === 'st' && raw.length === 1)) { words.push(...ABBR[low].split(' ')); return }
    const parts = segment(t)
    if (parts) { parts.forEach(p => words.push(ABBR[p] && !WORDS.has(p) ? ABBR[p] : p)); return }
    words.push(finish(t))
  })
  let out = words.map((w, i) => titleWord(w, i === 0)).join(' ').replace(/\s+/g, ' ').trim()
  // A unit at the end reads as a unit: "Distance Feet" -> "Distance (ft)".
  out = out.replace(/ (Feet|Ft)$/, ' (ft)').replace(/ (Miles|Mi)$/, ' (mi)').replace(/ (Meters|M)$/, ' (m)')
  return out
}

/** Is this alias a label someone wrote, or just the field name again? */
function realAlias (alias: string, name: string): boolean {
  const a = String(alias || '').trim()
  if (!a) return false
  const machine = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (machine(a) === machine(name.split('.').pop() || name)) return /[a-z]/.test(a) && /[A-Z]/.test(a) && /\s/.test(a)
  // All capitals ("PARCEL_NUM", "PARCEL NUMBER") reads like a field name: tidy it instead.
  if (!/[a-z]/.test(a) && a.length > 3) return false
  return true
}

/** The name to show for a field: its alias when it is a real label, else its name made readable. */
const LABELS = new Map<string, string>()
export function fieldLabel (f: { name?: string, alias?: string } | null | undefined): string {
  if (!f) return ''
  const name = String(f.name || '')
  const key = name + '\u0000' + String(f.alias || '')
  const hit = LABELS.get(key)
  if (hit !== undefined) return hit
  const v = f.alias && realAlias(f.alias, name) ? String(f.alias).trim() : (humanizeName(f.alias && !realAlias(f.alias, name) && f.alias.trim() ? f.alias : name) || name)
  if (LABELS.size > 5000) LABELS.clear()
  LABELS.set(key, v)
  return v
}

/** A key in a server's answer ("distance_feet", "FACILITYID") as a column heading. */
export function keyLabel (key: string): string {
  return /[ ]/.test(key) && /[a-z]/.test(key) ? key : humanizeName(key)
}
