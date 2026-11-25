# Questions that cross layers

Mappy answers questions about one thing by where it is relative to another. No AI, no server: the app's own layers do the work, with the signed-in person's own access.

## What people can ask

| Kind | Examples |
| --- | --- |
| Within a distance | "parcels within 300 ft of 250 N 5th St", "how many R-4 parcels over 5 acres are within a mile of a school", "hydrants within a quarter mile of the library" |
| Near (no distance) | "parcels near City Hall". He takes "near" as 500 ft, says so, and "what about 1000 ft" changes it |
| Inside or crossing | "hydrants in the floodplain", "parcels inside Ward 3", "which streets cross the C-1 zone" |
| Next to | "parcels adjacent to Compass Park", "parcels that share a lot line with 250 Oak St" |
| Outside, or too far | "parcels outside the city limits", "parcels not within 500 ft of a hydrant", "parcels over 5 acres more than 300 ft from a hydrant" |
| One answer per area | "how many hydrants per council district", "parks in each ward", "which district has the fewest hydrants" |
| Owners near a place | "owners within 300 ft of 250 Oak St", "who do I notify within 500 feet of this parcel", "300 ft notice list for 250 Oak St" (a builder setting, off by default) |

Either side can carry the filters he already reads on one layer: values ("zoned R-4", "out of service"), numbers ("over 5 acres"), dates ("sold since 2025"). The other side can be a whole layer ("a hydrant"), a filtered layer ("an out of service hydrant"), a feature by its name ("Compass Park", "Ward 3", "the R-4 zone"), an address or place, "here" (the middle of the map) or "it" (the place or feature just shown).

Every kind of answer works across layers: counts with a share, lists, rankings ("biggest parcel within 800 ft of City Hall"), totals and averages, and groups with a chart ("count parcels by land use within 600 ft of Compass Park").

## Follow-ups

The place stays with the conversation:

- "how many of those are zoned R-4", "which of those is the biggest", "what about R-8"
- "what about 500 ft", "make it a quarter mile" asks the same question at another distance
- "Only show them on the map" filters the layer to exactly those features
- A notice list with no distance ("notification list for 250 Oak St") makes him ask how far, and the next "300 ft" is the answer

## Owner lists (notice lists)

Off by default. Turn on **Owner lists near a place** in Mappy's settings for staff apps where that list is the job, and leave it off for public apps. With it off, the same question lists the parcels and nothing about their owners.

With it on, "owners within 300 ft of 250 Oak St" gives:

- how many parcels and how many different owners
- a table of owner, mailing address, property address and parcel number, from whichever of those fields the parcel layer has
- a **Save as a spreadsheet file** button with every row (up to 2,000)
- the subject property in the list, marked
- the lot outlined on the map with the distance drawn around it as a dashed line

The distance is measured from the lot line of the parcel at that address, which is how notice distances are usually written. If no parcel is found there, it is measured from the point, and he says so. The list comes from the parcel layer as it is that day; he reminds the person to check it against the official notice requirements before mailing.

## How it works, and what that means for accuracy

Each side of the question is read against the layers' real fields and values, the same way one-layer questions are. Then the layer's own service does the geometry: every step is an ordinary query with a shape, a distance and a relation. Mappy does not union or buffer anything in the browser, so the answer is the one the layer's query gives.

- **Distances** are measured by the service from the edge of a shape, not its middle.
- **In** for areas inside areas (parcels in a zoning district) means the insides overlap. Sharing only an edge does not count, so the neighbours along a boundary are not swept in.
- **Next to** means within 3 ft, so lots that share a line count and lots across a street do not.
- **Per area** counts by where each feature is. One that sits on a line between two areas is counted in both, and he says so. When the layer already records the area in a field ("count parcels by zoning"), he uses the field instead, which is exact and quicker.
- **The dashed line** on the map is for looking at. It is worked from a shape's outer corners, so it is exact for an ordinary lot and a little generous where a shape bends inward. The count and the list come from the service, not from the line.

## Limits he tells you about

- The other side of a question can have at most 300 features ("within 500 ft of a hydrant" in a city with 5,000 hydrants is refused with the number, and a suggestion to narrow it). Each one is a query, and this keeps a chat question from flooding the map service.
- When more than 4,000 features match in a way that has to be carried as a list (several shapes, "outside", "next to"), he gives the exact count and asks for something narrower before listing or filtering.
- "Only show them on the map" works for up to 1,000 features.
- Counting per area needs a layer of areas.
- Words he cannot match to a field, a value, a feature or a place are named, never guessed at.

## When he reads a sentence this way

Distances, "next to", "per", "cross", "intersect" and "inside" can only be about place, so those are read this way first. "In", "on" and "outside" are everyday words ("parcels in R-4", "hydrants not in service"), so those go to the ordinary reader first and are only read as place when it comes up empty and the other side really is an area on the map.

A plain list near an address with no filter ("hydrants within 500 ft of 250 Oak St") still gets the earlier answer, nearest first with the distance to each.

## Tests

`tests/spatial.cjs` covers how sentences are split and runs the questions above on the playground's made-up town, whose layers answer real spatial queries. Try them in the playground under **Across layers**.
