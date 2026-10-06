# SnapWorld

A Snap Map-style 3D map of the real world around your live location, built with three.js and OpenStreetMap data (via OpenFreeMap vector tiles, no API key needed).

**Live:** https://devguywilly.github.io/snapworld/ (deployed by GitHub Actions on every push to `main`)

## Run it

```bash
npm install
npm run dev            # http://localhost:5173 on this computer
```

On your phone (GPS and compass need HTTPS):

```bash
npm run dev:phone      # serves https://<your-computer-ip>:5173 on your Wi-Fi
```

Open the printed Network URL on the phone and accept the self-signed certificate warning. Then tap **Use my location** (iOS will also ask for compass access).

Test a specific place without GPS: `http://localhost:5173/?lat=55.9522&lon=-3.2003`

## Controls

**Map:** drag to pan, scroll or pinch to zoom, right-drag or two-finger gestures to rotate and tilt. Tap a place label to fly there.

**Walk mode** (walking-person button):

| | Keyboard + mouse | Phone | Gamepad |
|---|---|---|---|
| Move | WASD / arrows | left thumb (floating stick) | left stick |
| Look | click to lock the mouse, then move it | drag on the right side | right stick |
| Sprint | hold Shift | push the stick to the edge | L3 / RT |
| Walk | hold Alt or toggle C | light push on the stick | light push |
| Jump | Space | jump button | A |
| Camera distance | scroll / V | — | Y |
| Back to map | M or the button | button | — |

## How it works

- `src/tiles/tile.worker.ts` fetches z14 vector tiles and builds geometry off the main thread: extruded buildings (`builders/buildings.ts`), roads, parks and water (`builders/ground.ts`), seeded procedural trees (`builders/trees.ts`).
- `src/tiles/TileManager.ts` streams tiles around the camera and evicts old ones.
- `src/render/materials.ts` contains the lit-window shader; `palette.ts` holds the night colours.
- `src/geo/` is the GPS/compass service and a local metre-based coordinate frame that re-centres as you travel.
- `src/camera/MapCamera.ts` is the Snap-style map camera.
- `src/player/` holds walk mode: unified input, the character controller (acceleration, turning, jumping, wall sliding) and the GTA-style third-person camera (collision-aware boom, auto-recentre, sprint FOV).
- `src/tiles/Collision.ts` stores wall segments and tree trunks per tile, for player collisions and camera raycasts.
- `src/labels/` covers place labels with collision-free placement and the category filter chips.

See [PLAN.md](PLAN.md) for the roadmap.
