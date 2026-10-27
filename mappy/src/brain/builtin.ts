/*
  builtin.ts - what Mappy knows out of the box about Experience Builder's own widgets,
  keyed by the widget folder name in the uri (widgets/arcgis/legend/ -> legend).
  Custom widgets describe themselves through their manifest.json description, which the
  brain reads at runtime and during the deep scan.
*/

export interface WidgetKnowledge {
  does: string
  how?: string
  keys?: string
}

export const BUILTIN_WIDGETS: { [name: string]: WidgetKnowledge } = {
  'arcgis-map': { does: 'Shows the interactive map.', how: 'Drag to pan, scroll or pinch to zoom, click a feature to see its popup.', keys: 'map view scene' },
  'map-layers': { does: 'Lists the map layers so you can turn them on and off.', how: 'Check or uncheck a layer. Use the layer menu for zoom to, transparency and the attribute table.', keys: 'layer list toc table of contents' },
  legend: { does: 'Explains the symbols and colors on the map.', how: 'Only visible layers show in the legend.', keys: 'symbols symbology key' },
  search: { does: 'Finds addresses, places and features.', how: 'Type in the box and pick a suggestion.', keys: 'geocode address find locate' },
  query: { does: 'Runs saved queries against layers and lists the results.', how: 'Pick a query, set any filters or draw an area, then Apply.', keys: 'query report results' },
  filter: { does: 'Filters layers so only matching features show.', how: 'Turn on a filter or fill in its values.', keys: 'filter subset' },
  table: { does: 'Shows layer attributes in a table.', how: 'Pick a tab to switch layers. Sort, search and select rows.', keys: 'attribute table rows records' },
  print: { does: 'Prints or exports the map to PDF or an image.', how: 'Pick a template and format, then Print.', keys: 'print pdf export' },
  measurement: { does: 'Measures distance and area on the map.', how: 'Pick distance or area, then click on the map.', keys: 'measure distance area' },
  draw: { does: 'Draws shapes and text on the map.', how: 'Pick a tool and click on the map.', keys: 'draw sketch markup' },
  select: { does: 'Selects features on the map.', how: 'Pick a layer and draw a shape or click features.', keys: 'select selection' },
  bookmark: { does: 'Jumps the map to saved places.', how: 'Click a bookmark.', keys: 'bookmark saved place' },
  'basemap-gallery': { does: 'Switches the background map.', how: 'Click a basemap thumbnail.', keys: 'basemap imagery aerial' },
  coordinates: { does: 'Shows the coordinates under the mouse or a clicked point.', keys: 'coordinates xy lat long' },
  directions: { does: 'Finds driving or walking directions between stops.', keys: 'route directions' },
  'near-me': { does: 'Finds features near a location.', keys: 'nearby buffer proximity' },
  'add-data': { does: 'Adds your own data to the map from a file, URL or ArcGIS.', keys: 'add data upload shapefile csv' },
  edit: { does: 'Edits feature attributes and geometry.', keys: 'edit editor' },
  'elevation-profile': { does: 'Draws an elevation profile along a line.', keys: 'elevation profile terrain' },
  chart: { does: 'Charts layer data.', keys: 'chart graph' },
  list: { does: 'Lists records from a layer as cards.', keys: 'list records' },
  'feature-info': { does: 'Shows details for the selected feature.', keys: 'feature info details' },
  'info-summary': { does: 'Summarizes features in the current view.', keys: 'summary count' },
  swipe: { does: 'Swipes between layers to compare them.', keys: 'swipe compare' },
  timeline: { does: 'Plays time-aware data over time.', keys: 'time slider timeline' },
  share: { does: 'Shares a link to this app, or a QR code or embed code.', how: 'Click Share and pick how to send it.', keys: 'share link url qr email' },
  'my-location': { does: 'Zooms to your current location.', keys: 'gps location locate me' },
  'oriented-imagery': { does: 'Shows street-level or oblique photos for a location.', keys: 'photos imagery oblique' },
  'analysis': { does: 'Runs spatial analysis tools.', keys: 'analysis geoprocessing' },
  'utility-network-trace': { does: 'Traces a utility network.', keys: 'trace utility network' },
  'business-analyst': { does: 'Runs demographic reports.', keys: 'demographics infographics' },
  'survey123': { does: 'Shows a Survey123 form.', keys: 'survey form' },
  embed: { does: 'Shows an embedded web page.', keys: 'embed page' },
  button: { does: 'A button that opens a link, page or window.', keys: 'button link' },
  image: { does: 'An image, sometimes with a link.', keys: 'image logo picture' },
  text: { does: 'Text on the page.', keys: 'text' },
  controller: { does: 'A toolbar that opens other widgets.', keys: 'toolbar controller' },
  navigator: { does: 'Switches between views.', keys: 'views navigation tabs' },
  menu: { does: 'A menu of pages.', keys: 'menu navigation pages' },
  'map-centric': { does: 'Map with surrounding panels.', keys: 'map' }
}

/** Layout and plumbing widgets: never listed as a "tool" the user can open. */
export const PLUMBING = new Set([
  'controller', 'column', 'row', 'fixed', 'sidebar', 'card', 'divider', 'spacer', 'placeholder',
  'navigator', 'menu', 'text', 'image', 'embed', 'button', 'views-navigation', 'grid', 'accordion',
  'section', 'social-media'
])

/** widgets/arcgis/legend/ -> legend, widgets/my-widget/ -> my-widget */
export function widgetName (uri: string): string {
  const parts = String(uri || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || ''
}

export function isOutOfTheBox (uri: string): boolean {
  return /^widgets\/(common|arcgis|layout)\//.test(String(uri || ''))
}
