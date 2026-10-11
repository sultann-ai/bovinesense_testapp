# Map style and API key setup (Google Maps)

The dashboard draws on a Google Maps **vector map with a cloud-based Map ID**. The basemap look (cream
land, muted roads, faint labels) is *not* in the code: it is a Map Style you create in Google Cloud
Console and attach to the Map ID. The app only needs two values:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser API key, restricted to your domains (see [Protecting the key](#protecting-the-api-key)) |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | The Map ID that carries the style below |

Both are public by design (they ship to the browser), so the **restriction on the key is the
protection**. Neither value is committed: they live in `.env.local` locally and in the host's
environment settings in production. `.env.example` lists names only.

> **Status of this document.** The palette comes from `docs/DESIGN.md` §3 "Map palette". The style
> JSON below was written by hand and has **not** been imported into a real Cloud Console project from
> this repository (no valid key was available while it was built). Treat step 4 as "import, then look at
> the result and adjust", and use the checklist at the end to confirm it.

## 1. Palette (from DESIGN.md)

| Element | Colour |
|---|---|
| Land | `#F3EDE3` (cream) |
| Water | `#CFDCE0` |
| Major roads (highway, arterial) | fill `#FFFFFF`, casing `#E3D9CA` |
| Minor roads (local) | `#EDE5D8` |
| District boundaries | `#B9AE9C`, dashed, 1 px (**drawn by the app**, see below) |
| Place labels | `#6B655C` |
| Secondary labels (roads, water, minor places) | `#B9AE9C` (faint) |
| Points of interest, transit | hidden |

The aim, per DESIGN.md: a cream basemap makes the status-coloured animal markers the loudest thing on
screen. If a label or road competes with a marker, make it fainter rather than adding colour.

## 2. Create the Map ID and Map Style

1. Open **Google Cloud Console → Google Maps Platform → Map Management** (project with billing on).
2. **Map Styles → Create Style.** Choose **Import JSON** (or start from "Blank" / "Standard" and apply
   the settings by hand from §3), name it `BovineSense cream`, and import the JSON in §4.
3. Check the preview over Punjab (Lahore, Faisalabad, Multan). **Publish** the style.
4. **Map IDs → Create Map ID.** Name it `bovinesense-dashboard`, set **Map type: JavaScript**, and
   **Vector** rendering (needed for Advanced Markers, which the animal pins use). Leave tilt and rotation
   **off**: the dashboard is a flat, north-up map.
5. Under the Map ID, **Map style → choose `BovineSense cream`**.
6. Copy the Map ID into `NEXT_PUBLIC_GOOGLE_MAP_ID`.

Changing the style later needs no deploy: edit and **Publish** in the Console and reload the page.

## 3. Style settings, by hand

If you prefer to click rather than import, set these in the style editor (Map features → ...):

| Feature | Setting |
|---|---|
| **Base map → Geometry** (everything not listed below) | Fill `#F3EDE3` |
| **Base map → Labels → Text fill** | `#6B655C`; **Text outline** `#F3EDE3`, weight 3 |
| **Base map → Labels → Icons** | Off |
| **Landscape** (natural, man-made) | Fill `#F3EDE3` |
| **Water → Geometry** | Fill `#CFDCE0` |
| **Water → Labels** | Text fill `#B9AE9C` |
| **Roads → Highway** | Fill `#FFFFFF`, stroke `#E3D9CA` |
| **Roads → Arterial** | Fill `#FFFFFF`, stroke `#E3D9CA` |
| **Roads → Local** | Fill `#EDE5D8`, stroke off |
| **Roads → Labels** | Text fill `#B9AE9C` |
| **Points of interest** | Off (geometry, labels and icons) |
| **Transit** | Off |
| **Administrative → Country** | Stroke `#B9AE9C`, weight 1 |
| **Administrative → Province / Locality** | Text fill `#6B655C` (place labels); stroke off (see "Boundaries") |
| **Administrative → Neighborhood / Land parcel** | Labels off |

"Faint" in the brief maps to two colours only: `#6B655C` for the labels people read (cities, provinces)
and `#B9AE9C` for everything secondary. Do not go lighter: `#B9AE9C` on cream is already about the
limit of legibility, which is the intent for secondary text.

## 4. Style JSON (import)

Cloud-based styling accepts the classic styling JSON on import. Paste this into **Import JSON**:

```json
[
  { "elementType": "geometry", "stylers": [{ "color": "#F3EDE3" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#6B655C" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#F3EDE3" }, { "weight": 3 }] },

  { "featureType": "administrative.country", "elementType": "geometry.stroke", "stylers": [{ "color": "#B9AE9C" }, { "weight": 1 }] },
  { "featureType": "administrative.province", "elementType": "geometry.stroke", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#6B655C" }] },
  { "featureType": "administrative.neighborhood", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.land_parcel", "stylers": [{ "visibility": "off" }] },

  { "featureType": "landscape", "elementType": "geometry", "stylers": [{ "color": "#F3EDE3" }] },

  { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
  { "featureType": "transit", "stylers": [{ "visibility": "off" }] },

  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#B9AE9C" }] },
  { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#F3EDE3" }] },
  { "featureType": "road.local", "elementType": "geometry.fill", "stylers": [{ "color": "#EDE5D8" }] },
  { "featureType": "road.local", "elementType": "geometry.stroke", "stylers": [{ "visibility": "off" }] },
  { "featureType": "road.arterial", "elementType": "geometry.fill", "stylers": [{ "color": "#FFFFFF" }] },
  { "featureType": "road.arterial", "elementType": "geometry.stroke", "stylers": [{ "color": "#E3D9CA" }] },
  { "featureType": "road.highway", "elementType": "geometry.fill", "stylers": [{ "color": "#FFFFFF" }] },
  { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#E3D9CA" }] },

  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#CFDCE0" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#B9AE9C" }] }
]
```

Import maps most of this onto Cloud features; if the editor reports an element it could not map, set
that row by hand from §3.

## Boundaries: why the style does not draw them

District boundaries come from PostGIS (`district_boundaries`), not from Google. The app draws them as
`google.maps.Data` geometry (hover and click) plus **dashed polylines** in `#B9AE9C`, 1 px. Dashes are
drawn by the app because `google.maps.Data` cannot dash a stroke, and Google's own province lines are
switched off in the style so there are not two sets of lines. Edit the dash look in
`src/components/map/BoundaryLayer.tsx` (colours come from the `--map-boundary` token in
`src/app/globals.css`), not in the Console.

Likewise the animal pins, clusters, geofences and trails are drawn by the app, with colours from CSS
tokens. The Map Style only controls the basemap underneath.

## Satellite

The **Satellite** button switches the map to Google's `hybrid` type. Map-ID styling only applies to the
roadmap, so satellite shows Google's own imagery with labels; that is intended (officers use it to check
a farm on the ground).

## Protecting the API key

A browser key can be read by anyone who opens the page. What protects it is its restriction:

1. **Cloud Console → APIs & Services → Credentials → the key.**
2. **Application restrictions → Websites (HTTP referrers).** Add only your own origins, with the path
   wildcard. Examples (replace with your real domains):
   - `https://dashboard.example.com/*`
   - `https://*.example.com/*` (only if you really serve the app from several subdomains)
   - `http://localhost:3000/*` on a **separate development key**, not the production one.
3. **API restrictions → Restrict key** to **Maps JavaScript API** only. (Do not add Geocoding, Places
   etc. to this key. If one is needed later, give it its own server-side key.)
4. Use **one key per environment** (development, staging, production) so a leaked dev key cannot spend
   production quota and can be revoked alone.
5. **Billing → Budgets & alerts**: set a monthly budget with alerts at 50 / 90 / 100 %. In **Quotas**,
   cap *Map loads per day* at a number you would be comfortable paying for.
6. **Rotate** the key (create a new one, deploy, delete the old one) if it was ever pasted into a chat,
   a ticket, a screenshot or a commit.

Rules in this repository:

- The key is read from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` only (`src/lib/maps/config.ts`). It is never
  hardcoded, and `tests/maps-no-secrets.test.ts` fails if an `AIza…` key or a stray hex colour appears
  under `src/components/map`.
- `.env*` files are git-ignored; `.env.example` has names, no values.
- If the key is missing, or Google rejects it (`gm_authFailure`, e.g. referrer not allowed), the map area
  shows an explanatory message rather than a broken grey box. The "referrer not allowed" case almost
  always means the domain you are browsing from is not in the key's referrer list.

### Cost note

Google bills one **map load** each time a `Map` is created. The Overview page creates one; opening an
animal drawer creates another (the mini map); the geofence dialog creates another. Mini maps are only
created when the drawer opens, and the map is not re-created when data refreshes. Keep this in mind when
setting the daily quota above.

## Verifying with a real key (manual checklist)

Automated tests cannot do these, because Google's script refuses to build a working map with a fake key
(see "What the automated tests cover" below). With a real key and Map ID, check once per deployment:

- [ ] The map opens fitted to the service area (Punjab by default), not the world; you cannot pan or
      zoom out to a world view.
- [ ] **Punjab**, **Pakistan** and **Fit to all animals** buttons move the camera as labelled.
- [ ] The basemap is cream with white roads, pale water, faint labels and no shops or transit.
- [ ] Zoomed out (below zoom 10) animals group into clusters; a cluster containing a breach has a crimson
      ring and a breach-count badge, and the count is right. Zooming to 10+ shows individual pins.
- [ ] A pin shows the status colour, the cattle glyph, and its status in words (hover title); a selected
      pin has a gold ring; an unacknowledged breach pulses (and does not with *reduce motion* on); a stale
      pin is grey at 60% with a clock badge.
- [ ] District boundaries are faint and dashed; labels appear from zoom 8.
- [ ] **Geofences → New geofence → Draw on map**: draw a polygon (click corners, double-click to close)
      and a circle (click the centre, move out, click); the saved fence reloads in the same place. The pencil
      on a fence row opens the edit bar: drag corners or resize the circle, then **Save changes**. A user
      who is not an organization admin cannot save (the database refuses).
- [ ] Animal drawer → **Show trail**: dots and a line for 24 h / 7 days, and the playback slider moves a
      highlighted dot along the fixes.
- [ ] Satellite toggle switches and switches back; markers and boundaries stay.
- [ ] With the key's referrer list *not* including the current domain, the page shows the key-problem
      message.

## What the automated tests cover

- Pure logic: view bounds, cluster summaries, status styling, geometry and fence payloads, trail
  parsing and playback (`tests/maps-*.test.ts`).
- The **real** terra-draw (polygon, circle, select modes) driven through a test adapter, feeding the same
  functions that build the API request (`tests/maps-terra-draw.test.ts`).
- The **real** `@googlemaps/markerclusterer` and its supercluster over a fake map, through the real marker
  layer (`tests/maps-marker-layer.test.tsx`): what clusters at which zoom, breach badges, live updates.
- The map options the app asks Google for (Map ID, restriction, minimum zoom, roadmap/hybrid), the
  provider's states (not configured, key rejected, script failed, map crashed) and the view buttons
  (`tests/maps-canvas.test.tsx`, `tests/maps-provider-controls.test.tsx`); trail loading and playback
  (`tests/maps-trail-panel.test.tsx`).
- The fence routes (`tests/geofence-routes.test.ts`) and the database side of fence editing
  (`tests/db/geofences.test.ts`: PostGIS validation, authorisation).
- No Google key and no hard-coded colour in the map code (`tests/maps-no-secrets.test.ts`).
- A browser smoke test loads the **real** Maps script with a fake key against a production build and checks
  what the app does around the map: the script URL (`region=PK`), the options the map is created with,
  one pin per animal with the right status and pulse, boundaries reaching the `Data` layer, selecting a
  pin, and that the page survives Google rejecting the key.

They do **not** exercise Google's tiles, the Cloud style, the terra-draw **Google Maps adapter**, or
Google's own cluster rendering: Google refuses to build a working map with an invalid key, and after it
rejects the key its own code can throw when further maps are created (the app contains this: a crashed
map is replaced by a notice and the rest of the page keeps working). Use the checklist above for those.
