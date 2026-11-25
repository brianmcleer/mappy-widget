# Handing a place to another widget

Mappy can find a place and hand it to another widget in the app: a report tool, a lookup,
anything that has a message action taking a location. People then ask for that widget by its
own name:

- "property report for 250 Main St"
- "run the site lookup on this parcel"
- "report for it" (the place just found, or the search result on the map)
- "everything about 250 Main St" (when only one widget is wired)

After he finds an address he also offers a button named for each wired widget.

## Set it up (builder)

1. Select Mappy, open the **Action** tab, and choose **Add a trigger**.
2. Pick **Location changes**.
3. Pick the target widget, then its action (for a report widget, its "generate report" action).
4. Save. There is nothing to set in Mappy.

Mappy reads this wiring from the app, so the names people use are your widgets' labels. Rename
a widget and the words follow. A map as a target (pan, zoom) still runs but is not offered by name.

## How it works

- Mappy publishes Experience Builder's standard `LOCATION_CHANGE` message with the point in
  longitude and latitude (WGS84). He opens the named widget first, then publishes.
- Every action wired to that trigger runs, as with any Experience Builder message.
- The message is only sent when someone asks for a wired widget or presses its button. Finding
  an address on its own sends nothing.
- No wiring, no change: the phrases above are read only when a widget is wired.

## For widget authors

To be a target, a widget needs a message action whose `filterMessageDescription` accepts
`MessageType.LocationChange`, reading `message.point` (`x`, `y`, `spatialReference`).
