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

| | Desktop | Phone |
|---|---|---|
| Pan | drag | one-finger drag |
| Zoom | scroll | pinch |
| Rotate / tilt | right-drag or ctrl-drag | two-finger twist / drag |
| Walk mode | walking-person button, then WASD / arrows, drag to look, Shift to run | joystick (push to the edge to run), drag to look |
| Back to me | arrow button | arrow button |

## How it works

- `src/tiles/tile.worker.ts` fetches z14 vector tiles and builds geometry off the main thread: extruded buildings (`builders/buildings.ts`), roads, parks and water (`builders/ground.ts`), seeded procedural trees (`builders/trees.ts`).
- `src/tiles/TileManager.ts` streams tiles around the camera and evicts old ones.
- `src/render/materials.ts` contains the lit-window shader; `palette.ts` holds the night colours.
- `src/geo/` is the GPS/compass service and a local metre-based coordinate frame that re-centres as you travel.
- `src/camera/` holds the Snap-style map camera and walk mode (with building collisions).
- `src/labels/` covers place labels with collision-free placement and the category filter chips.

See [PLAN.md](PLAN.md) for the roadmap.
