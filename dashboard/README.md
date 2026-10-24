# RoadSense

RoadSense detects road impacts with an MPU6050 and uses a VL53L0X with a fixed reference board for centimeter-scale positioning on a straight tabletop route. GPS provides approximate geographic context only; it does not control the tabletop route marker.

## Workflow

1. Start SpacetimeDB in a separate terminal: `spacetime start`.
2. Publish the `roadsense-v3` module if it has not been published locally.
3. Start the dashboard from this directory: `npm run dev`.
4. Open `http://127.0.0.1:8080` in Chrome or Edge.
5. Connect the ESP32 and place the vehicle at the start, facing the reference board.
6. Select **Start Detection** and keep the vehicle still for about one second while the start point is calibrated.
7. During the first run, every confirmed impact is recorded once and acknowledged with one short vibration.
8. Select **End Detection** and return the vehicle to the same start point.
9. Select **Warning**. The motor and buzzer give one synchronized short warning about 3 cm before each saved hazard.

## Code Map

- `src/roadsense/main.js`: page workflow and controls
- `src/roadsense/state.js`: configuration and live state
- `src/roadsense/protocol.js`: ESP32 message parser
- `src/roadsense/serial.js`: Web Serial connection
- `src/roadsense/routes.js`: routes, impacts, and the 3 cm warning rule
- `src/roadsense/ui.js`: route map, scale, chart, and UI rendering
- `src/spacetime-client.ts`: SpacetimeDB live synchronization
- `spacetimedb/src/index.ts`: backend route/event tables and deletion reducers
- `../road-detector-esp32/src/main.cpp`: ESP32 firmware

## Database

The active database is `roadsense-v3`. Each detection run creates an independent route. Hazards belong to routes through `route_id`. Individual false detections or complete routes can be deleted.

## Claude Integration

Claude route analysis is integrated into the dashboard. Add a valid `ANTHROPIC_API_KEY` to `.env` and restart the dashboard to analyze completed routes. Detection, storage, and warning functions remain available if the external API is temporarily unavailable.

## Validation

```bash
npm run typecheck
npm run build
npm run doctor
```
