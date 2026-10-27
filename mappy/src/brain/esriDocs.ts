/*
  esriDocs.ts - end-user help for Experience Builder's out-of-the-box widgets, written in
  plain words from Esri's documentation pages (doc.arcgis.com, Experience Builder, latest,
  read October 2026). Paraphrased, not copied. `url` records the source page for maintainers only; Mappy never shows it.
  The settings panel pulls in the entries for the widgets an app actually uses.
  Keyed by the widget folder name in the uri (widgets/arcgis/legend/ -> legend).
*/

export interface EsriDoc {
  title: string
  url: string
  summary: string
  howTo: string[]
  tips: string[]
  faq: Array<{ q: string, a: string }>
}

export const ESRI_DOCS_READ = '2026-10'

export const ESRI_DOCS: { [name: string]: EsriDoc } = {
  "3d-toolbox": {
    "title": "3D Toolbox",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/3d-toolbox-widget.htm",
    "summary": "A toolbar of 3D tools for scenes: daylight, weather, shadow cast, line of sight and slice.",
    "howTo": [
      "Open a tool from the toolbar.",
      "Daylight: set a date and drag the time slider, and play it to animate.",
      "Weather: choose sunny, cloudy, rainy, snowy or foggy and adjust sliders.",
      "Shadow cast: pick a time range and analysis type, then hover to read shadow time.",
      "Line of sight: click an observer point then target points.",
      "Slice: place a plane and drag its edges, and click a layer to exclude it.",
      "Use Clear to remove an effect."
    ],
    "tips": [
      "Closing a panel does not remove its effect, use Clear.",
      "Shadow cast ignores terrain and daylight saving time.",
      "Set the time zone manually if automatic detection is wrong.",
      "It needs a 3D scene connected through a Map widget."
    ],
    "faq": [
      {
        "q": "Why is the shadow still there?",
        "a": "Closing the panel does not clear it, use Clear."
      },
      {
        "q": "Why are the times off?",
        "a": "Set the time zone manually."
      },
      {
        "q": "Why does terrain cast no shadow?",
        "a": "Shadow cast ignores terrain."
      }
    ]
  },
  "accordion": {
    "title": "Accordion",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/accordion-widget.htm",
    "summary": "A stack of expandable headers that each hold a widget so you can open only what you need.",
    "howTo": [
      "Click a header's toggle to expand or collapse it.",
      "Use Expand all or Collapse all, if shown.",
      "Look for headers that open on load."
    ],
    "tips": [
      "Some accordions allow only one open header at a time.",
      "Panels usually open downward.",
      "Some headers may open automatically when the app loads."
    ],
    "faq": [
      {
        "q": "Why did another header close?",
        "a": "Single expand mode allows one open at a time."
      },
      {
        "q": "How do I open them all?",
        "a": "Use Expand all if available."
      },
      {
        "q": "Where is the toggle?",
        "a": "At the start or end of each header."
      }
    ]
  },
  "add-data": {
    "title": "Add Data",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/add-data-widget.htm",
    "summary": "Lets you temporarily add extra data to the map from search, a URL, or a file.",
    "howTo": [
      "Open the Add Data panel.",
      "Use Search to find items in your content, organization, or public content.",
      "Use URL by choosing the type and entering the address.",
      "Use File by dragging in or browsing for a file such as CSV, KML, GeoJSON, GPX, or zipped shapefile.",
      "Add the layer to the map."
    ],
    "tips": [
      "Added data is temporary and is not saved.",
      "Zip shapefiles and file geodatabases before uploading.",
      "File limits: CSV 1,000 records, others 4,000; shapefiles 2 MB, others 10 MB.",
      "Premium content needs sign in."
    ],
    "faq": [
      {
        "q": "Is my data saved?",
        "a": "No, it disappears when you leave."
      },
      {
        "q": "What file types work?",
        "a": "Shapefile (zip), CSV, KML, GeoJSON, GPX, and file geodatabase (zip)."
      },
      {
        "q": "Why can't I add from outside my organization?",
        "a": "The administrator may restrict it."
      }
    ]
  },
  "analysis": {
    "title": "Analysis",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/analysis-widget.htm",
    "summary": "Lets you run spatial analysis tools on map data and review your results in a history list.",
    "howTo": [
      "Open the Tools tab and pick a tool.",
      "Fill in the parameters; required ones are marked and the info button explains each.",
      "Choose input layers from the map or browse your content.",
      "Name the output layer and choose a folder.",
      "Click Estimate credits to see the cost, then click Run.",
      "Open the History tab to view details, reopen a tool with its last settings, or export results if allowed."
    ],
    "tips": [
      "You need to be signed in with analysis privileges.",
      "Built in spatial tools use credits.",
      "Raster tools need ArcGIS Image for ArcGIS Online.",
      "Other widgets can send a selected feature to a tool with a Set as Analysis input action."
    ],
    "faq": [
      {
        "q": "Why am I asked to sign in?",
        "a": "Analysis needs an account with the right privileges."
      },
      {
        "q": "Where did my result go?",
        "a": "Check the History tab, then View details."
      },
      {
        "q": "How much will a run cost?",
        "a": "Click Estimate credits before you run."
      }
    ]
  },
  "arcgis-map": {
    "title": "Map",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/map-widget.htm",
    "summary": "The main map you look at and move around in. Built in tools let you zoom, jump home, find your location, switch layers or basemaps, measure, select features, and go fullscreen.",
    "howTo": [
      "Zoom with the plus and minus buttons, the mouse wheel, or pinch on a touch screen.",
      "Drag the map to pan; on touch screens use one finger.",
      "Click Home to return to the starting view.",
      "Click Locate to center on your current location; click again to change how it follows you.",
      "Click the Compass to point the map north again.",
      "Open Layers to turn layers on or off, or Basemap to change the background.",
      "Click a feature to open its pop-up; use Dock or Undock to move the pop-up.",
      "Use Fullscreen to expand the map to fill the screen."
    ],
    "tips": [
      "Which tools you see depends on what the app author turned on.",
      "On short or small screens some tools are hidden automatically.",
      "With the Select tool, hold Shift to add to the selection and Ctrl (Cmd on Mac) to remove from it.",
      "With the Measure tool, hold Ctrl to turn off snapping to nearby features.",
      "The overview map and extent navigation (back and forward through past views) may be available but hidden on small screens."
    ],
    "faq": [
      {
        "q": "How do I get back to the starting view?",
        "a": "Click the Home button."
      },
      {
        "q": "Why is a map tool missing?",
        "a": "The app author may not have enabled it, or the map is too short to show it."
      },
      {
        "q": "How do I move the pop-up?",
        "a": "Use the Dock or Undock button in the pop-up."
      },
      {
        "q": "How do I select several features?",
        "a": "Use the Select tool, then hold Shift while selecting to add more."
      }
    ]
  },
  "basemap-gallery": {
    "title": "Basemap Gallery",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/basemap-gallery-widget.htm",
    "summary": "Lets you change the background map, such as imagery, streets, or terrain.",
    "howTo": [
      "Open the gallery.",
      "Click a basemap thumbnail to apply it.",
      "Compare views by switching and watching the layers stay in place."
    ],
    "tips": [
      "Grayed out basemaps are not compatible with the current map.",
      "Some people see no basemaps if the organization restricts anonymous access.",
      "Your data layers stay on top when you change the basemap."
    ],
    "faq": [
      {
        "q": "How do I switch to satellite?",
        "a": "Pick an imagery basemap in the gallery."
      },
      {
        "q": "Why is a basemap grayed out?",
        "a": "It does not work with this map."
      },
      {
        "q": "Why is the gallery empty?",
        "a": "You may need to sign in."
      }
    ]
  },
  "bookmark": {
    "title": "Bookmark",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/bookmark-widget.htm",
    "summary": "Lets you jump to saved map views, and sometimes save your own.",
    "howTo": [
      "Click a bookmark to move the map to that view.",
      "In slide layouts, move between bookmarks with the arrows or by scrolling.",
      "Add your own bookmark with the add button, if available.",
      "Wait for auto play, if on, to move through bookmarks."
    ],
    "tips": [
      "Clicking a bookmark may also change which layers are visible.",
      "Drawings saved with a bookmark may show with it.",
      "If the map does not jump on load, click a bookmark to start.",
      "Auto play moves the map on its own."
    ],
    "faq": [
      {
        "q": "How do I save my current view?",
        "a": "Use the add bookmark button, if the app offers it."
      },
      {
        "q": "Why did layers change when I clicked a bookmark?",
        "a": "The bookmark stored its own layer visibility."
      },
      {
        "q": "Why do I see no bookmarks?",
        "a": "The widget may not be connected to a map."
      }
    ]
  },
  "business-analyst": {
    "title": "Business Analyst",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/business-analyst-widget.htm",
    "summary": "Builds infographics with demographic and business data for a place you choose, which you can view or export.",
    "howTo": [
      "Search for a location, or draw or select a point or polygon on the map.",
      "Set buffers such as rings, drive time or walk time, if allowed.",
      "Pick an infographic template from the Infographic tab, if allowed.",
      "View the infographic in the widget.",
      "Export to PDF, Excel, image or HTML, up to five reports at a time.",
      "In preset apps, click the map to run it for that spot, if enabled."
    ],
    "tips": [
      "Drive and walk times have limits and live traffic is not everywhere.",
      "Selecting records in other widgets may only list them and not run the infographic.",
      "You may need to sign in if you lack the data privilege.",
      "Complex custom infographics can time out."
    ],
    "faq": [
      {
        "q": "Why is it asking me to sign in?",
        "a": "Some data needs an account with the right privilege."
      },
      {
        "q": "Can I change the location?",
        "a": "Yes in workflow mode, but a cached preset infographic is fixed."
      },
      {
        "q": "How do I save the result?",
        "a": "Export it to PDF, Excel, image or HTML."
      }
    ]
  },
  "button": {
    "title": "Button",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/button-widget.htm",
    "summary": "A clickable button that takes you to a page, section, window or web address, or triggers an action in the app.",
    "howTo": [
      "Click the button to go where it points.",
      "Hover to see its tooltip.",
      "Select a feature in a connected map or list if the button is dynamic, and its text or link updates.",
      "Use buttons that open or toggle a sidebar or a widget in the controller."
    ],
    "tips": [
      "Links open in the same window, top window or a new window as the author set.",
      "A dynamic button can differ from one selection to the next.",
      "Web links must start with https://."
    ],
    "faq": [
      {
        "q": "Why did the button text change?",
        "a": "It reflects the feature you selected."
      },
      {
        "q": "Why did nothing happen?",
        "a": "The link may be missing or invalid."
      },
      {
        "q": "Will it open a new tab?",
        "a": "Only if the author set it that way."
      }
    ]
  },
  "card": {
    "title": "Card",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/card-widget.htm",
    "summary": "A container that groups text, images, buttons and other widgets, and can act as a clickable link.",
    "howTo": [
      "Read or use the content inside the card.",
      "Hover to see the hover look, if enabled.",
      "Click the card to open its link, if there is one.",
      "Use buttons or widgets inside as normal."
    ],
    "tips": [
      "Without a link, clicking the card does nothing.",
      "Hover effects need a mouse pointer.",
      "Links open in the same window, top window or a new window as the author set."
    ],
    "faq": [
      {
        "q": "Why does clicking do nothing?",
        "a": "The card has no link."
      },
      {
        "q": "Why does it change when I point at it?",
        "a": "It has a hover style."
      },
      {
        "q": "Where does it take me?",
        "a": "To the page, section, window or web address the author set."
      }
    ]
  },
  "chart": {
    "title": "Chart",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/chart-widget.htm",
    "summary": "Shows data as a graph, such as bar, line, pie, histogram, or scatterplot, and can link to the map.",
    "howTo": [
      "Hover over a bar, point, or slice to see its value.",
      "Click a chart element to highlight features on the map or open them in a table, if linked.",
      "Use the Selection and Zoom tool to pick items or zoom, if shown.",
      "Drag the range slider above the chart to change the visible range.",
      "Read the legend for series and categories."
    ],
    "tips": [
      "Charts do not have general filter controls.",
      "Large data sets may be grouped or limited, such as scatterplots over 10,000 points.",
      "Labels may rotate or hide when crowded.",
      "If there is no data, a message may show."
    ],
    "faq": [
      {
        "q": "How do I see exact values?",
        "a": "Hover over the chart element."
      },
      {
        "q": "Why doesn't clicking do anything?",
        "a": "The author may not have linked the chart to other widgets."
      },
      {
        "q": "Why are some points combined?",
        "a": "Large scatterplots group nearby points."
      }
    ]
  },
  "controller": {
    "title": "Widget Controller",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/widget-controller-widget.htm",
    "summary": "A toolbar of widget icons that opens each widget in a panel when you click it.",
    "howTo": [
      "Click an icon to open that widget.",
      "Click it again, or use the close button, to close it.",
      "Use Expand and Collapse to resize a panel without closing it.",
      "Click More widgets or use arrows when the icons overflow.",
      "Click a group to see its widgets in a stacked menu."
    ],
    "tips": [
      "In Single mode opening one widget closes the other, in Multiple mode several stay open.",
      "Some widgets such as Draw, My Location, Share, Swipe, Timeline and 3D Toolbox appear outside the panel.",
      "Floating panels can be resized by dragging the bottom corners.",
      "On small screens panels show at the bottom of the app."
    ],
    "faq": [
      {
        "q": "Where did my widget go?",
        "a": "Check More widgets or the group."
      },
      {
        "q": "Why did one panel close when I opened another?",
        "a": "The controller is in Single mode."
      },
      {
        "q": "Can I resize a panel?",
        "a": "Floating panels, yes, by dragging the bottom corners."
      }
    ]
  },
  "coordinates": {
    "title": "Coordinates",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/coordinates-widget.htm",
    "summary": "Shows the location of your pointer or a clicked point as coordinates, with a choice of coordinate system.",
    "howTo": [
      "Move the pointer over the map to see its coordinates, or click to place a point, if the app allows.",
      "Pick a coordinate system from the drop-down.",
      "Click Copy to copy the displayed values."
    ],
    "tips": [
      "In 3D scenes you may also see elevation and camera height.",
      "Decimal places and order are set by the app author.",
      "Values can differ between systems, especially in different datums."
    ],
    "faq": [
      {
        "q": "How do I copy coordinates?",
        "a": "Click the Copy button."
      },
      {
        "q": "How do I change the system?",
        "a": "Use the drop-down."
      },
      {
        "q": "Why is there no elevation?",
        "a": "Elevation only shows for 3D scenes."
      }
    ]
  },
  "directions": {
    "title": "Directions",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/directions-widget.htm",
    "summary": "Gets a route between two or more places with turn by turn instructions.",
    "howTo": [
      "Enter a start and end by typing an address or place, or clicking the map.",
      "Add more stops if needed; drag stops to reorder.",
      "Choose travel mode and time or distance, and set a departure time if offered.",
      "Click Solve if the route does not update automatically.",
      "Click the route to see turn by turn steps.",
      "Use Optimize order for the best stop sequence.",
      "Use Edit route to add barriers to avoid blocked roads.",
      "Print the route, or save it as a layer if allowed."
    ],
    "tips": [
      "Reverse is available with two stops.",
      "Locator searches may be limited to a country or the current map view.",
      "Clear removes all stops.",
      "Barrier layers have size limits per request."
    ],
    "faq": [
      {
        "q": "How do I avoid a road?",
        "a": "Use Edit route to add a barrier line."
      },
      {
        "q": "How do I reorder stops?",
        "a": "Drag them up or down."
      },
      {
        "q": "Why does nothing happen after I add stops?",
        "a": "Click Solve if automatic solving is off."
      }
    ]
  },
  "draw": {
    "title": "Draw",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/draw-widget.htm",
    "summary": "Lets you sketch points, lines, shapes, and text on the map to mark things up.",
    "howTo": [
      "Pick a drawing tool: point, line, polygon, rectangle, circle, freehand, or text.",
      "Adjust the symbol, color, size, or font before drawing.",
      "Click on the map to draw; finish as the tool prompts (often double-click).",
      "Turn on measurements to label lengths or areas, if offered.",
      "Use the select tools to pick drawings, then duplicate, edit, or delete them.",
      "Use Undo and Redo to fix mistakes.",
      "Use Clear all to remove every drawing.",
      "Use Export to save drawings, or Append from file to bring them back, if offered."
    ],
    "tips": [
      "While drawing you can press Tab to type exact values such as coordinates or lengths, if enabled.",
      "Snapping options only appear if the author turned them on.",
      "Drawings are not saved when you leave unless you export them."
    ],
    "faq": [
      {
        "q": "How do I erase a drawing?",
        "a": "Select it and delete it, or use Clear all."
      },
      {
        "q": "Can I save my drawings?",
        "a": "Yes, use Export drawings if available."
      },
      {
        "q": "How do I add text?",
        "a": "Use the text tool and click the map."
      }
    ]
  },
  "edit": {
    "title": "Edit",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/edit-widget.htm",
    "summary": "Lets you create, update, and delete features and their attributes.",
    "howTo": [
      "Select a feature in the map, table, or another connected widget.",
      "Change attribute values in the form and save.",
      "Use Create features to draw a new feature on the map.",
      "Drag vertices to change shape, if available.",
      "Delete a selected record if allowed.",
      "Use batch edit to change several features at once, if enabled."
    ],
    "tips": [
      "You must select a feature first; the widget only shows selected features.",
      "The widget warns you before you lose unsaved edits.",
      "Pasting and batch editing are not available in 3D scenes.",
      "Pasted features are limited to 200 at a time, batch edits to 500 per layer."
    ],
    "faq": [
      {
        "q": "Why is Edit empty?",
        "a": "Select a feature first."
      },
      {
        "q": "Why can't I edit a layer?",
        "a": "It may be read only or you lack permission."
      },
      {
        "q": "Will I lose changes?",
        "a": "The widget warns you if you leave without saving."
      }
    ]
  },
  "elevation-profile": {
    "title": "Elevation Profile",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/elevation-profile-widget.htm",
    "summary": "Draws a graph of height along a line you sketch or select on the map.",
    "howTo": [
      "Start the tool and draw a path on the map, or select an existing line.",
      "Read the profile graph.",
      "Hover over the graph to see values.",
      "Click legend items to hide or show parts of the graph.",
      "Open Profile Statistics to see slope, gain, loss, min and max.",
      "Export the data as CSV if offered."
    ],
    "tips": [
      "Results clear when the widget closes unless the app keeps them.",
      "Layers without z-values may show ground elevation only.",
      "Export only appears if enabled."
    ],
    "faq": [
      {
        "q": "How do I get a profile?",
        "a": "Draw a path or select a line on the map."
      },
      {
        "q": "What stats are shown?",
        "a": "Slope, elevation gain and loss, and min and max elevation."
      },
      {
        "q": "Can I save it?",
        "a": "Export as CSV, if available."
      }
    ]
  },
  "embed": {
    "title": "Embed",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/embed-widget.htm",
    "summary": "Shows outside content such as a web page, video, document or another app inside the experience.",
    "howTo": [
      "Use the embedded content as you would on its own site, with its own buttons and controls.",
      "Select a feature if the embed is linked to a layer, and the content may change to match.",
      "Sign in inside the embed if it asks for it."
    ],
    "tips": [
      "Only secure HTTPS content can appear.",
      "Controls belong to the embedded site, not to the widget.",
      "Some PDFs may not show in certain browsers.",
      "The content may refresh on a timer."
    ],
    "faq": [
      {
        "q": "Why is the embed blank?",
        "a": "The link may be incomplete, blocked or not secure."
      },
      {
        "q": "Why do I need to sign in again?",
        "a": "The embedded site may not share your sign in."
      },
      {
        "q": "Why will the video not autoplay?",
        "a": "Your browser may block sound autoplay for the site."
      }
    ]
  },
  "feature-info": {
    "title": "Feature Info",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/feature-info-widget.htm",
    "summary": "Displays the pop-up style details of the feature you select, including related records when available.",
    "howTo": [
      "Select a feature on the map or in a connected widget to see its details.",
      "Use the arrows to step through features; a counter such as 1 of 25 may show your position.",
      "Use the data drop-down to switch between data sources, if shown.",
      "Click Clear selection to remove the current selection.",
      "Open the actions menu to work on the current record or on all records, for example export or zoom to."
    ],
    "tips": [
      "If a layer has no pop-up set up, you see a plain list of attributes.",
      "The panel may include layers you did not expect because it lists everything on the connected map.",
      "Zooming to a feature on selection only happens if the app author set that up."
    ],
    "faq": [
      {
        "q": "Why is nothing showing?",
        "a": "No feature is selected, or the selected feature has none of the expected values. Click a feature."
      },
      {
        "q": "Can I see related records?",
        "a": "Yes, if the layer's pop-up was set up with them."
      },
      {
        "q": "Where is the export option?",
        "a": "In the actions menu, if the author enabled data actions."
      }
    ]
  },
  "filter": {
    "title": "Filter",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/filter-widget.htm",
    "summary": "Lets you narrow what shows in the map, tables, and lists by turning filters on or off or entering values.",
    "howTo": [
      "Find the filter you want in the panel.",
      "Switch it on to apply it, off to remove it.",
      "Expand a collapsed filter to see its options.",
      "Type or choose a value when the filter asks for one.",
      "Use Reset all filters to return to the starting state, if the button is there.",
      "Use Turn off all filters to clear everything, if the button is there.",
      "If a custom filter is offered, build your own conditions."
    ],
    "tips": [
      "A filter changes the data itself, so every widget using that layer updates.",
      "Several filters combine as all must match or any may match, set by the author.",
      "Value choices may shrink based on other filters you set.",
      "Auto applied filters inside a collapsed panel only start working after you open it."
    ],
    "faq": [
      {
        "q": "Why did my table or map change?",
        "a": "Filters apply to the shared data, so connected widgets update."
      },
      {
        "q": "How do I clear filters?",
        "a": "Switch each off, or use Reset all or Turn off all filters if available."
      },
      {
        "q": "Why are my value choices limited?",
        "a": "Choices can depend on filters you already set."
      }
    ]
  },
  "fly-controller": {
    "title": "Fly Controller",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/fly-controller-widget.htm",
    "summary": "A toolbar for 3D scenes that animates the camera by orbiting a point, flying along a path, or playing preset routes.",
    "howTo": [
      "Pick a fly style: Rotate fly, Fly along path, or Plan routes.",
      "Draw a point or path, or select a feature on the map.",
      "Adjust tilt or altitude in Settings.",
      "Press Play to start and Pause to stop.",
      "Use the speed bar while flying to change speed.",
      "Clear to remove the point or path."
    ],
    "tips": [
      "Set your view before sketching a point.",
      "After pausing, setting changes apply on the next Play.",
      "Plan routes are preset and cannot be edited.",
      "It needs a 3D web scene in the connected map."
    ],
    "faq": [
      {
        "q": "Why is there no toolbar?",
        "a": "The map needs a 3D web scene layer."
      },
      {
        "q": "Can I orbit the map center?",
        "a": "Yes, Rotate fly can use the center of the current view."
      },
      {
        "q": "How do I change speed?",
        "a": "Use the speed bar while it is flying."
      }
    ]
  },
  "image": {
    "title": "Image",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/image-widget.htm",
    "summary": "Shows a picture, or several pictures for a selected feature, that you can expand, zoom and sometimes click.",
    "howTo": [
      "Click arrows, or swipe on a touch screen, to move between images.",
      "Hover to see a tooltip.",
      "Click the image to follow its link, if there is one.",
      "Click the expand button to open a larger view.",
      "Zoom from 10 to 1000 percent and pan around the large image."
    ],
    "tips": [
      "The expand button is missing for dynamic symbols.",
      "With several features, only the first one's images show.",
      "Fill may crop the image while Fit shows all of it.",
      "Alt text is for screen readers, not for display."
    ],
    "faq": [
      {
        "q": "How do I see a bigger image?",
        "a": "Use the expand button."
      },
      {
        "q": "Why can I not see more images?",
        "a": "Only the first feature's attachments are shown."
      },
      {
        "q": "Why is part of the image cut off?",
        "a": "The widget may use the Fill setting."
      }
    ]
  },
  "legend": {
    "title": "Legend",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/legend-widget.htm",
    "summary": "Shows the symbols and labels that explain what the visible layers on the map mean.",
    "howTo": [
      "Look at the legend to see what each symbol or color stands for.",
      "Turn layers on in the map or Map Layers widget so they show up in the legend.",
      "Scroll the legend if it is longer than the panel.",
      "Pan or zoom the map if the legend only shows layers in the current view."
    ],
    "tips": [
      "The legend is read only; there are no buttons to click.",
      "Some layers never show: vector tile, web tile, KML, map notes, graphics, and a few others.",
      "Map image and WMS layers show as one entry, so you cannot toggle their sublayers here.",
      "Basemap entries only show if the app author turned that on."
    ],
    "faq": [
      {
        "q": "Why is a layer missing from the legend?",
        "a": "It may be off, outside the current view, or a type the legend cannot show."
      },
      {
        "q": "Why did the legend change when I zoomed?",
        "a": "The app may list only layers in the current map extent."
      },
      {
        "q": "Can I turn layers on here?",
        "a": "No, use the map's Layers tool or the Map Layers widget."
      }
    ]
  },
  "list": {
    "title": "List",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/list-widget.htm",
    "summary": "Shows records from a layer as a scrollable set of cards you can search, sort, filter and select.",
    "howTo": [
      "Type in the search box and pick a suggestion or press Enter to find records.",
      "Open the sort drop-down to change the order of the cards.",
      "Use the filter options to narrow the list, and the reset button to undo them.",
      "Click a card to select it; the matching feature highlights on the map.",
      "Click the refresh button to reload the latest data.",
      "Use Show selection to see only selected cards and Clear selection to unselect all.",
      "Open the actions menu to export, zoom to or filter by the records."
    ],
    "tips": [
      "Only tools the app author turned on appear.",
      "Search suggestions match whole words or word starts, so a piece from the middle of a word may not suggest anything.",
      "Show selection and Clear selection only appear if selection is enabled in the app.",
      "Exports include only the fields the list actually uses."
    ],
    "faq": [
      {
        "q": "Why does my search show no results?",
        "a": "Nothing matched, or a filter is active. Reset the filters and try a full word or the start of a word."
      },
      {
        "q": "How do I select more than one card?",
        "a": "It depends on the app. Some apps add to the selection on each click, others replace it."
      },
      {
        "q": "How do I see only what I picked?",
        "a": "Click Show selection if it is available."
      }
    ]
  },
  "map-layers": {
    "title": "Map Layers",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/map-layers-widget.htm",
    "summary": "Shows the list of layers in the map so you can turn them on or off and, if allowed, adjust how each one looks or behaves.",
    "howTo": [
      "Tick or untick a layer's check box to show or hide it.",
      "Type in the search box to find a layer by name.",
      "Use the batch menu to turn all layers on or off, or expand and collapse groups.",
      "Open a layer's options to zoom to it, show labels, change transparency, or set the zoom range where it shows.",
      "Drag layers up or down to change their order.",
      "Open Details to read about the layer, or expand Legend to see its symbols.",
      "Use a layer's data actions (filter, statistics, export, add to table) if they are offered."
    ],
    "tips": [
      "Options per layer only appear if the app author enabled them.",
      "Remove only works on layers added while the app is running, such as with Add Data.",
      "To remove drawings, use the Draw widget's Delete or Clear all instead.",
      "Export gives CSV, JSON, or GeoJSON."
    ],
    "faq": [
      {
        "q": "Why can't I see a layer in the list?",
        "a": "The app author may have limited which layers are listed."
      },
      {
        "q": "How do I zoom to a layer?",
        "a": "Open its options and choose Zoom to."
      },
      {
        "q": "Can I remove a layer?",
        "a": "Only layers you added during this session, not the map's original layers."
      },
      {
        "q": "Can I reorder layers?",
        "a": "Yes, drag them, if the list has at least two layers."
      }
    ]
  },
  "measurement": {
    "title": "Measurement",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/measurement-widget.htm",
    "summary": "Lets you measure distance and area on the map and read results in the units you choose.",
    "howTo": [
      "Choose the Distance or Area tool.",
      "Click on the map to start, then click each point along the line or shape.",
      "Double-click to finish.",
      "Read the length, or the area and perimeter, in the panel.",
      "Change the unit with the Unit drop-down.",
      "Click New measurement to start again, or Clear measurement to remove it."
    ],
    "tips": [
      "Forgetting to double-click leaves the measurement unfinished.",
      "Snapping to nearby features is on; hold Ctrl to turn it off for a point.",
      "In 3D scenes you also get vertical and direct distances; 2D maps give horizontal only."
    ],
    "faq": [
      {
        "q": "How do I finish a measurement?",
        "a": "Double-click the last point."
      },
      {
        "q": "How do I change units?",
        "a": "Use the Unit drop-down."
      },
      {
        "q": "Why does my point jump?",
        "a": "Snapping moved it to a nearby feature; hold Ctrl to avoid it."
      }
    ]
  },
  "menu": {
    "title": "Menu",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/menu-widget.htm",
    "summary": "A navigation menu with pages, links and folders that takes you around the app.",
    "howTo": [
      "Click a menu item to go to that page.",
      "Hover or click a parent item to open its dropdown.",
      "Use the arrows if the menu overflows.",
      "Click the menu icon to open a side panel menu.",
      "Expand or fold submenus in vertical or icon menus."
    ],
    "tips": [
      "Clicking a folder name does not change the page.",
      "Pages hidden from the menu will not appear.",
      "Arrows appear only when the menu is too long."
    ],
    "faq": [
      {
        "q": "Where is a page I used to see?",
        "a": "It may be hidden from the menu or nested in a folder."
      },
      {
        "q": "Why does the folder not open a page?",
        "a": "Folders only hold other items."
      },
      {
        "q": "Why did the menu become an icon?",
        "a": "The app uses an icon style, click it to open."
      }
    ]
  },
  "my-location": {
    "title": "My Location",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/my-location-widget.htm",
    "summary": "Finds where you are and shows it on the map, either once or continuously as a tracked path.",
    "howTo": [
      "Click Get location to find your position once.",
      "If watching is enabled, click Start watching to track you continuously and End watching to stop and create a path.",
      "Click Trace a path to build a path by hand.",
      "Use Show or Hide to turn the location symbols on the map on or off.",
      "Delete a single record, or Clear results to remove them all.",
      "Open the actions menu to export the data or zoom to locations."
    ],
    "tips": [
      "Your records live in the browser only, so refreshing or closing the page erases them. Export first to keep them.",
      "Export formats include JSON, CSV, GeoJSON or an ArcGIS item.",
      "If it takes too long you get an error that the location cannot be retrieved.",
      "Deleting locations can change the related paths and the reverse."
    ],
    "faq": [
      {
        "q": "Why can it not find me?",
        "a": "The request may have timed out or location access was not allowed in your browser. Check the permission and try again."
      },
      {
        "q": "How do I save my track?",
        "a": "Use the export action before closing the page."
      },
      {
        "q": "Does it track me automatically?",
        "a": "Only if the app author turned on automatic start."
      }
    ]
  },
  "navigator": {
    "title": "Views Navigation",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/view-navigation-widget.htm",
    "summary": "Lets you switch between views of a section with tabs, icons, a slider or arrows.",
    "howTo": [
      "Click a tab or icon to show that view.",
      "Drag the slider handle to move through views.",
      "Use Previous and Next arrows for one view at a time.",
      "Hover over an icon to see its view name."
    ],
    "tips": [
      "Arrows only show when the tabs or icons overflow.",
      "Names and order come from the section.",
      "Switching views may also open another widget such as a sidebar."
    ],
    "faq": [
      {
        "q": "Why can I not see all views?",
        "a": "Use the arrows to scroll."
      },
      {
        "q": "Why did a panel open when I changed view?",
        "a": "The app was set up to do that."
      },
      {
        "q": "Does the page reload?",
        "a": "No, only that section refreshes."
      }
    ]
  },
  "near-me": {
    "title": "Near Me",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/near-me-widget.htm",
    "summary": "Finds features close to a location or in the current map view, and can list, summarize, or export them.",
    "howTo": [
      "Choose to search the current map area or a specified location.",
      "Set the location by searching, clicking the map, sketching, or using Locate.",
      "Set the distance and units if offered.",
      "Choose the analysis: Closest, Proximity, or Summary.",
      "Review results; expand items for details.",
      "Click a result to highlight it, or use it as a new location if enabled.",
      "Export results if available."
    ],
    "tips": [
      "Closest feature is not available when searching the current map area.",
      "With 10,000 or more results, click Retrieve all before exporting.",
      "Results clear when you close the widget unless the app keeps them.",
      "Hidden layers may not show results."
    ],
    "faq": [
      {
        "q": "How do I find the nearest feature?",
        "a": "Set a location and choose Closest feature."
      },
      {
        "q": "Why can't I export?",
        "a": "With 10,000 or more results, click Retrieve all first."
      },
      {
        "q": "Where did my results go?",
        "a": "They clear when the widget closes unless kept."
      }
    ]
  },
  "oriented-imagery": {
    "title": "Oriented Imagery Viewer",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/oriented-imagery-viewer-widget.htm",
    "summary": "Shows oriented imagery, such as street level or oblique photos, for a place you click on the map, with tools to move between images and measure.",
    "howTo": [
      "Turn on Enable viewer, then click a spot on the map to load its imagery.",
      "Use the layer drop-down to switch imagery layers.",
      "Move between images with directional arrows, previous and next buttons, or the thumbnail gallery.",
      "Use the footprint and camera location overlays to see where each image covers on the map.",
      "Use the measurement tools for distance, area or height, if offered.",
      "Adjust brightness, contrast and sharpness with image enhancement, and reset to restore the original."
    ],
    "tips": [
      "Only tools the app author enabled appear.",
      "A missing direction arrow means there is no image that way.",
      "Triangulated measurements need two images from different views.",
      "Enhancement settings stick for later images until the widget closes."
    ],
    "faq": [
      {
        "q": "Why is the viewer empty?",
        "a": "Turn on Enable viewer and click a location that has imagery."
      },
      {
        "q": "How do I measure something in the image?",
        "a": "Use the measurement tools if the app offers them."
      },
      {
        "q": "What do the red and blue map shapes mean?",
        "a": "Red marks the current image coverage and blue marks other images that include your point."
      }
    ]
  },
  "print": {
    "title": "Print",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/print-widget.htm",
    "summary": "Creates a printable map layout or PDF/image of what you see in the map.",
    "howTo": [
      "Choose a template (layout).",
      "Turn on Show print area to see what will be printed.",
      "Adjust options such as title, quality, or size if offered.",
      "Click Print.",
      "Open the result from the result list; it opens in a new window.",
      "If signed in, use Save as to save the result as an ArcGIS item."
    ],
    "tips": [
      "In compact mode you can only keep one result; click Reset to print again.",
      "Custom layouts and reports need an organization sign in; each job uses credits.",
      "Public users cannot use the premium custom layout printing.",
      "Printing works only with a 2D map."
    ],
    "faq": [
      {
        "q": "How do I print a map?",
        "a": "Pick a template, click Print, then open the result."
      },
      {
        "q": "Why can't I print again?",
        "a": "In compact mode, click Reset first."
      },
      {
        "q": "Why is printing blocked for me?",
        "a": "Custom layouts need a signed in organization account."
      }
    ]
  },
  "query": {
    "title": "Query",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/query-widget.htm",
    "summary": "Lets you run preset searches on data, using attribute values or location, and see matching records in a list and on the map.",
    "howTo": [
      "Pick a query from the list.",
      "Enter values for any attribute criteria shown.",
      "Set the location criteria if offered, such as current map extent, a shape you draw, or features from another layer.",
      "Run the query to get a list of results.",
      "Click a result to highlight it or zoom to it on the map.",
      "Use the export option, if shown, to save results as CSV, JSON, GeoJSON, or an ArcGIS item.",
      "Change the page size or scroll to see more records."
    ],
    "tips": [
      "Results may be capped by the layer's maximum record count.",
      "Very complex shapes with many vertices can return no results.",
      "You may need to click a button to show results on the map, depending on the app.",
      "Exports may only include the displayed fields."
    ],
    "faq": [
      {
        "q": "Why are there no results?",
        "a": "Criteria may be too narrow, or a very detailed shape overloaded the query."
      },
      {
        "q": "How do I see results on the map?",
        "a": "Click the show on map or zoom option if provided; some apps do it automatically."
      },
      {
        "q": "Can I download results?",
        "a": "Yes, if export is enabled in this app."
      }
    ]
  },
  "search": {
    "title": "Search",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/search-widget.htm",
    "summary": "Lets you search for places, addresses, or data records and move the map to the result.",
    "howTo": [
      "Click the search box and type a word, address, or place name.",
      "Pick a suggestion, or press Enter or click the search button.",
      "Use the arrow keys to move through suggestions.",
      "If several sources are available, open the drop-down and turn sources on or off.",
      "Click a result to zoom or pan the map to it.",
      "To find a location by coordinates, type them as x, y: WKID."
    ],
    "tips": [
      "Layer searches match text anywhere, so 'alt' can return Alton and Baltimore.",
      "The app may limit results to the current map extent, hiding things outside your view.",
      "Searching a layer can also filter other widgets that use the same layer.",
      "If suggestions do not show, press Enter or click the search button.",
      "Recent searches or 'use current location' may be offered."
    ],
    "faq": [
      {
        "q": "Why do I get unexpected results?",
        "a": "Matches can be anywhere in the text; try a longer or more exact phrase."
      },
      {
        "q": "Why can't I find something I know exists?",
        "a": "It may be outside the map view or in a source that is turned off."
      },
      {
        "q": "How do I search by coordinates?",
        "a": "Enter x, y: WKID, for example a longitude, latitude pair and the coordinate system ID."
      }
    ]
  },
  "select": {
    "title": "Select",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/select-widget.htm",
    "summary": "Lets you pick features on the map using shapes or criteria, then act on them.",
    "howTo": [
      "Choose a layer in the list.",
      "Pick a selection tool: rectangle, lasso, circle, line, or point.",
      "Draw on the map to select features.",
      "Hold Shift to add, Ctrl (Cmd on Mac) to remove, Ctrl+Shift (Cmd+Shift) to select within the current selection.",
      "Use attribute or spatial selection options if shown.",
      "Open a layer's Actions to export, zoom to, view in table, get statistics, or directions."
    ],
    "tips": [
      "Partially within selects anything touching the shape; Wholly within needs features fully inside.",
      "Lasso and line tools finish with a double-click.",
      "Attribute selection limits interactive selection to a new selection only.",
      "You cannot select features from layers generated by other widgets at run time."
    ],
    "faq": [
      {
        "q": "How do I add to my selection?",
        "a": "Hold Shift while selecting."
      },
      {
        "q": "Why are no features selected?",
        "a": "Check the right layer is on and the selection mode fits (partial vs whole)."
      },
      {
        "q": "What can I do with selected features?",
        "a": "Use Actions, such as export or zoom to, if offered."
      }
    ]
  },
  "share": {
    "title": "Share",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/share-widget.htm",
    "summary": "Lets you share the app with others through a link, social media, email, embed code or QR code.",
    "howTo": [
      "Click the Share button, or pick a share tile if the options are shown inline.",
      "Copy the app link from the box.",
      "Check Short link to get a shorter URL.",
      "Check Include URL parameters to keep your current page and selections in the link; uncheck it for the plain app link.",
      "Choose a social media or email option to send it, or copy the embed code for a website.",
      "Use the QR code to open the app on a phone."
    ],
    "tips": [
      "Without URL parameters the recipient sees the app in its starting state.",
      "Custom email text set by the author is not translated for other languages.",
      "Which options you see depends on the app author."
    ],
    "faq": [
      {
        "q": "How do I share exactly what I am looking at?",
        "a": "Keep Include URL parameters checked before copying the link."
      },
      {
        "q": "How do I get a shorter link?",
        "a": "Check Short link."
      },
      {
        "q": "Can I put the app on my website?",
        "a": "Yes, if embed is offered, copy the embed code."
      }
    ]
  },
  "sidebar": {
    "title": "Sidebar",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/sidebar-widget.htm",
    "summary": "Splits the page into a main area and a side panel that you can show, hide and resize.",
    "howTo": [
      "Click the collapse button to show or hide the side panel.",
      "Drag the divider to resize, if allowed.",
      "Hover the collapse button for a tooltip."
    ],
    "tips": [
      "The panel may open or close by itself when you select or clear features.",
      "A button elsewhere may open or toggle the sidebar.",
      "If there is no collapse button the panel stays as it opened.",
      "With overlay, the side panel covers part of the main area."
    ],
    "faq": [
      {
        "q": "Why did the sidebar open on its own?",
        "a": "The app opens it when you select a feature."
      },
      {
        "q": "How do I make it bigger?",
        "a": "Drag the divider if resizing is enabled."
      },
      {
        "q": "Where is the collapse button?",
        "a": "The author may have removed it."
      }
    ]
  },
  "suitability-modeler": {
    "title": "Suitability Modeler",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/suitability-modeler-widget.htm",
    "summary": "Lets you build a weighted overlay model that scores places by combining layers, then view the result on the map.",
    "howTo": [
      "Select layers in the Select layers panel.",
      "Enter a weight percent for each layer; they must total 100.",
      "Assign scores from 0 to 9 to ranges, if not locked.",
      "Change the color ramp, if you like.",
      "Click Run to add or update the result layer.",
      "Use Generate chart to summarize results for a polygon you draw or select.",
      "Click Export to save the model, if shown."
    ],
    "tips": [
      "Weights not totaling 100 will block the run.",
      "Export shows only if you were signed in when the app loaded.",
      "Clear also removes results and charts."
    ],
    "faq": [
      {
        "q": "Why will it not run?",
        "a": "Check that weights total 100 percent."
      },
      {
        "q": "Where is Export?",
        "a": "You must be signed in with content creation rights when the app opened."
      },
      {
        "q": "How do I start over?",
        "a": "Click Clear."
      }
    ]
  },
  "survey123": {
    "title": "Survey",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/survey-widget.htm",
    "summary": "Lets you fill out a Survey123 survey inside the app, and in some setups pre fill, edit or view answers for a selected feature.",
    "howTo": [
      "Answer the questions and submit to save a new record.",
      "Select a feature in another widget to pre fill connected questions.",
      "Select a feature to edit its answers and submit the changes.",
      "Select a feature to view its saved answers read only, if the app is set that way."
    ],
    "tips": [
      "Depending on setup, changing the selection may reset the survey or only update the connected questions.",
      "Repeat submissions are off by default.",
      "Edit and view modes only work with newer surveys."
    ],
    "faq": [
      {
        "q": "Why are some answers already filled?",
        "a": "They come from the feature you selected."
      },
      {
        "q": "Can I submit twice?",
        "a": "Not by default; the author must allow it."
      },
      {
        "q": "Why can I not edit?",
        "a": "The app may be set to new record or read only mode."
      }
    ]
  },
  "swipe": {
    "title": "Swipe",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/swipe-widget.htm",
    "summary": "Lets you compare layers or maps by dragging a divider across the map so one side shows leading layers and the other shows trailing layers.",
    "howTo": [
      "Turn the swipe tool on with the toggle button.",
      "Drag the divider handle across the map to reveal each side (or use the scroll bar in the advanced style).",
      "Use the layer list to see which layers sit on each side; expand groups to see sublayers.",
      "Turn layers off from swiping or hide them, if those options are shown.",
      "Add your own data with the Add Data widget and pick whether it leads or trails, if allowed."
    ],
    "tips": [
      "Legend, Chart and other widgets tied to the same map react to the swipe too.",
      "Sublayers of groups added at run time are not listed.",
      "Advanced style and single map swipe do not work with web scenes or group layers.",
      "Swiping between two maps needs the app to be set up with two maps."
    ],
    "faq": [
      {
        "q": "How do I turn swipe off?",
        "a": "Use the same toggle button that turned it on."
      },
      {
        "q": "Can I choose which layers get swiped?",
        "a": "Yes, if the author allows deactivating layers, otherwise the layers are fixed."
      },
      {
        "q": "Why can I not swipe my added layer?",
        "a": "Group layers and some layer types are not supported."
      }
    ]
  },
  "table": {
    "title": "Table",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/table-widget.htm",
    "summary": "Shows the attributes of layer features in rows and columns, with tools to search, sort, select, and sometimes edit.",
    "howTo": [
      "Switch between layers using the tabs or drop-down.",
      "Type in the search box to find records.",
      "Click a column header to sort; add more sorts for several fields.",
      "Click rows to select them; use Show selection to see only selected rows and Clear selection to reset.",
      "Use the show or hide columns menu to choose fields.",
      "Hover a row to highlight its feature on the map.",
      "Use Refresh to reload the latest data.",
      "Use Filter by map extent, if shown, to list only features in view.",
      "Use Export, if shown, to save the data."
    ],
    "tips": [
      "Hover over long text to read the full value.",
      "URLs show as View buttons.",
      "Double-click a cell to edit when editing is enabled; in multi edit mode click Save to keep changes or Reset to discard.",
      "You can only edit or delete if the layer allows it and you have permission.",
      "A layer outside its visible scale range may say No data found."
    ],
    "faq": [
      {
        "q": "Why does the table say No data found?",
        "a": "The layer may be hidden or outside its visible zoom range."
      },
      {
        "q": "How do I edit a value?",
        "a": "Double-click the cell, if editing is enabled for you."
      },
      {
        "q": "How do I show only the features I picked?",
        "a": "Select rows, then click Show selection."
      },
      {
        "q": "Why is a layer missing?",
        "a": "The author may have limited which layers the table shows."
      }
    ]
  },
  "text": {
    "title": "Text",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/text-widget.htm",
    "summary": "Shows text, links and data driven values that can update when you select something in another widget.",
    "howTo": [
      "Scroll if the text is longer than the box.",
      "Click links to go to a page, section, window or web address.",
      "Hover for a tooltip if there is one.",
      "Select a feature in a connected widget to update data driven text."
    ],
    "tips": [
      "A fade and jumping arrow at the bottom means more text below.",
      "Without a selection a no data message may show.",
      "Style may change with the data if the author set it up."
    ],
    "faq": [
      {
        "q": "Why does it say no data?",
        "a": "Nothing is selected in the connected widget."
      },
      {
        "q": "Why is text cut off?",
        "a": "Scroll within the widget."
      },
      {
        "q": "Why did the text change?",
        "a": "It follows your selection."
      }
    ]
  },
  "timeline": {
    "title": "Timeline",
    "url": "https://doc.arcgis.com/en/experience-builder/latest/configure-widgets/timeline-widget.htm",
    "summary": "Lets you scrub or play through time enabled data and filter other widgets, like the map, to the chosen time.",
    "howTo": [
      "Press Play to animate through time and Pause to stop.",
      "Use Previous and Next to step one interval at a time.",
      "Drag the slider to jump to any time.",
      "Use Zoom in and Zoom out to change the time scale of the slider.",
      "Pick a playback speed from the five speed levels.",
      "Open the info button to see the full time range and the Timeline filtering applied toggle."
    ],
    "tips": [
      "The filter works on the shared data, so the map, list and table all show only the chosen time.",
      "Turn Timeline filtering applied off to see all data again, if the toggle is shown.",
      "Whether you see current features, a moving window or accumulating data was chosen by the app author.",
      "Controls like play may be hidden or preset by the author."
    ],
    "faq": [
      {
        "q": "Why did features disappear from my map?",
        "a": "The timeline is filtering by time. Turn the filtering toggle off or move the slider."
      },
      {
        "q": "Can I change the animation speed?",
        "a": "Yes, use the speed control if it is shown."
      },
      {
        "q": "What does the info button show?",
        "a": "The overall time range and the filtering toggle."
      }
    ]
  },
  "utility-network-trace": {
    "title": "Utility Network Trace",
    "url": "https://doc.arcgis.com/en/experience-builder/12.1/configure-widgets/utility-network-trace-widget.htm",
    "summary": "Lets you run traces on a utility network by placing starting points and barriers on the map, then shows the traced features.",
    "howTo": [
      "Place starting points on the map to set where the trace begins.",
      "Place barrier points where the trace should stop.",
      "Pick a configured trace and run it; you can run more than one at once.",
      "Review the results on the map and in the result list grouped by asset group and type.",
      "Look for a result area polygon with a pop-up, if the author turned it on."
    ],
    "tips": [
      "Trace settings are preset, so you choose a trace rather than set parameters.",
      "Results in areas with unvalidated edits may be inaccurate.",
      "It works with a utility network web map, not with traces on map services."
    ],
    "faq": [
      {
        "q": "Why can I not run a trace?",
        "a": "The map must have a valid utility network and shared trace configurations."
      },
      {
        "q": "Are the results reliable everywhere?",
        "a": "Not in dirty areas where the network topology is not validated."
      },
      {
        "q": "How do I stop a trace at a point?",
        "a": "Add a barrier point."
      }
    ]
  }
}
