/** Select only an unambiguous built-in map; never replace an author's choice. */
export function defaultMapIds (appConfig: any, selected: any): string[] | null {
  if (selected?.length || selected?.size) return null
  const widgets = appConfig?.widgets
  const ids = Object.keys(widgets || {}).filter(id => /(?:^|\/)(?:arcgis-)?map\/?$/i.test(widgets[id]?.uri || ''))
  return ids.length === 1 ? ids : null
}
