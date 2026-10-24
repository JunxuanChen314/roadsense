# RoadSense Data Export

While `npm run dev` is running, the SpacetimeDB `roadsense-v3.road_event` table is exported every five seconds to:

- `road-events.json`: for applications and submission materials
- `road-events.csv`: for direct use in Excel

These files are readable snapshots. SpacetimeDB remains the authoritative data store.
