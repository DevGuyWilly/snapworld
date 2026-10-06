# SnapWorld — plan

A web app that renders the real world around your live location as a stylized, explorable 3D map in the style of Snap Map's 3D view.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Platform | Web app: Vite + TypeScript + three.js, works on desktop and phone browsers |
| Location | **The world is always built around the user's live GPS position.** Nothing is hard-coded to a city |
| v1 scope | 3D map, you on it, place labels with category filter chips |
| Movement | Snap-style orbit camera **and** a street-level walk mode |
| Later | Memories (photos pinned by GPS), day/night by real time, friends' live locations |

## What "like Snap Map" means here (target look, from the reference screenshots)

- Buildings: real footprints extruded to real or estimated heights. Dark navy/indigo flat-roofed blocks, with lit window bands on the walls (white/lavender, some warm yellow) and subtle roof-edge shading.
- Ground: dark flat base, slightly lighter roads (no markings), teal parks and grass, dark water.
- Trees: chunky toy-like trees (round and pine shapes) in autumn colours, dense in parks and spaced along streets.
- Camera: angled perspective (about 45–60°) following you. Drag to pan, scroll or pinch to zoom, right-drag or two-finger gesture to rotate and tilt, recenter button, compass.
- You: a stylized avatar at your GPS position, with a bubble icon above, a "Me now" tag and a yellow heading cone from the phone compass.
- Labels: place name plus category ("Costa Coffee · Coffee Shop") with an icon. Labels never overlap (decluttering), and fewer show as you zoom out.
- Chrome: top row of filter chips (Cafés, Restaurants, Shops, Parks, Bars, Hotels…), a right-hand button column (layers, compass, recenter, walk mode), dark UI.

**Out of reach (being honest):** Snapchat's own data, Bitmoji avatars, and hand-made landmark models. OpenStreetMap has heights for only some buildings; the rest get estimates.

## Data source

**OpenFreeMap vector tiles**: free, no API key, OpenStreetMap data in the OpenMapTiles schema. Confirmed working: an Edinburgh z14 tile is about 310 KB.

Layers we use:
- `building`: footprint polygons with `render_height` and `render_min_height`
- `transportation`: roads with `class` (motorway → path), used for road width
- `water`, `waterway`, `park`, `landcover`, `landuse`: ground polygons
- `poi`: `name`, `class`, `subclass`, `rank`, used for labels and filters
- Trees: OpenStreetMap only has some trees mapped as points, so trees are generated procedurally inside parks, woods and grass areas and along streets. Generation is seeded per tile, so trees appear in the same places every visit.

Tiles are fetched at z14 (max detail) and decoded with `@mapbox/vector-tile` + `pbf`.

## Architecture

```
snapworld/
  src/
    main.ts                 app bootstrap
    geo/
      mercator.ts           lat/lon ⇄ world metres (local origin, avoids float jitter)
      location.ts           GPS watchPosition + compass heading, smoothing, fallbacks
    tiles/
      TileManager.ts        which tiles are visible, load/unload, LRU cache
      tile.worker.ts        fetch + decode MVT + build geometry OFF the main thread
      builders/
        buildings.ts        footprint → extruded walls + roof (earcut), UVs for windows
        ground.ts           roads (polyline → ribbon), parks, water polygons
        trees.ts            seeded tree placement → instance transforms
    render/
      Scene.ts              renderer, lights, fog, post (optional bloom on windows)
      materials/
        buildingMaterial.ts shader: navy walls + procedural lit windows
        palette.ts          night palette (day palette slots reserved for later)
      Trees.ts              InstancedMesh pools
    camera/
      MapCamera.ts          Snap-style orbit/pan/zoom/tilt, follow-me, recenter
      WalkCamera.ts         street-level walking, avatar follow, simple collision
    avatar/
      Avatar.ts             glTF character (CC0, e.g. Quaternius), idle/walk animations
      MeMarker.ts           bubble icon, "Me now" tag, heading cone
    labels/
      LabelLayer.ts         DOM labels projected from 3D, declutter, LOD by rank
      categories.ts         OSM class → category, icon, chip
    ui/                     chips, right-side buttons, compass, permission prompts
```

Key technical choices:
- **Local coordinate frame.** World units are metres measured from an origin near you. The origin shifts when you move far, so precision stays good and nothing jitters.
- **Work in a web worker.** Each tile becomes merged geometry: about 3 draw calls for buildings, ground and roads, plus instanced trees. Geometry is built off the main thread so panning never stutters.
- **Window shader.** Window positions come from world-space height (about 3 m per floor) and wall length (about 2.5 m bays). A hash decides which windows are lit and how warm the light is. No textures needed, and it costs almost nothing.
- **Tile range.** A ring of about 3×3 z14 tiles (about 7 km across) around the camera, with fog hiding the edge. Tiles outside the range are freed.
- **UI.** Vanilla TS + CSS for the overlay. It's small, and that keeps the bundle lean. (Can switch to React if the UI grows.)
- **HTTPS.** The phone only gives live GPS and compass over a secure connection. Dev runs `vite --host` with a local HTTPS certificate, so it works on your phone over Wi-Fi.

## Location flow

1. On open, request the user's location (`watchPosition`, high accuracy).
2. First fix arrives: set the world origin there, load the surrounding tiles, drop the avatar. The camera starts on the user.
3. As the user moves, the avatar follows, tiles stream in, and the origin re-centres after large moves.
4. While waiting for a fix, the last known position (saved on this device) is shown so the map isn't blank.
5. If permission is denied or GPS is unavailable, a clear message explains how to enable it, with a "search a place" box to explore elsewhere in the meantime. The search uses the OpenStreetMap Nominatim service and only sends what the user types.
6. Dev/testing only: `?lat=..&lon=..` in the URL overrides GPS, e.g. to compare against the Edinburgh screenshots.

## Phases

1. **Scaffold + location + map camera.** Vite/TS project, scene, Snap-style camera, mercator helpers. On launch, ask for location and centre the world on the user's GPS fix. A location screen covers "waiting for GPS", "permission denied" and "unavailable".
2. **Tile streaming + buildings + ground.** Worker pipeline, extruded buildings, roads, parks, water. Tiles load and unload as you pan.
3. **Snap look.** Night palette, lit-window shader, stylized trees, lighting and fog tuned against the screenshots.
4. **Live tracking + avatar.** Continuous GPS updates and compass, avatar with "Me now" tag and heading cone, smooth movement between fixes, follow-me and recenter, new tiles stream in as the user walks.
5. **Labels + filter chips.** POI labels with icons and decluttering, chip filtering.
6. **Walk mode.** Drop to street level and walk the avatar (WASD or on-screen joystick), with building collision and a smooth camera transition back to the map view.

I check each phase in the browser with screenshots before moving on.

## Later (not in v1)
- Memories: import photos, read GPS from their EXIF data, show them as 3D cards with count badges (stored in IndexedDB)
- Day/night palette from real sunrise/sunset at your location
- Friends: accounts + realtime locations (e.g. Supabase)
- Embed in the SnapMap iOS app via a WebView
- Deploy (Vercel/Netlify) so it runs on your phone anywhere

## Risks
- **Data quality varies.** Heights and POIs are rich in Edinburgh, sparse in some areas, so estimated heights fill the gaps.
- **Phone performance.** Mitigated by merged geometry, instancing, a capped pixel ratio and a smaller tile range on mobile.
- **iOS compass.** Safari asks permission for the compass on a tap. The heading cone hides until it's granted.
- **OpenFreeMap fair use.** Fine for personal use. A public deploy should cache tiles or host its own.
