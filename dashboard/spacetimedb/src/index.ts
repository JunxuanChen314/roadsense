import { schema, table, t } from "spacetimedb/server";

const roadEvent = table(
  { name: "road_event", public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    routeId: t.string().index("btree").default("legacy"),
    eventKey: t.string().index("btree").default(""),
    deviceId: t.string().index("btree"),
    impact: t.f64(),
    distanceMm: t.u64(),
    latitude: t.f64(),
    longitude: t.f64(),
    detectedAt: t.timestamp(),
    risk: t.string(),
    status: t.string(),
  },
);

const roadRoute = table(
  { name: "road_route", public: true },
  {
    id: t.string().primaryKey(),
    deviceId: t.string().index("btree"),
    startDistanceMm: t.u64(),
    startedAt: t.timestamp(),
    endedAt: t.string().default(""),
    status: t.string(),
  },
);

const spacetimedb = schema({ roadEvent, roadRoute });
export default spacetimedb;

export const startRoute = spacetimedb.reducer(
  { id: t.string(), deviceId: t.string(), startDistanceMm: t.u64() },
  (ctx, route) => {
    if (ctx.db.roadRoute.id.find(route.id)) throw new Error("route already exists");
    ctx.db.roadRoute.insert({
      ...route,
      startedAt: ctx.timestamp,
      endedAt: "",
      status: "detecting",
    });
  },
);

export const finishRoute = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    const route = ctx.db.roadRoute.id.find(id);
    if (!route) throw new Error("route not found");
    ctx.db.roadRoute.id.update({
      ...route,
      endedAt: ctx.timestamp.toISOString(),
      status: "completed",
    });
  },
);

export const recordEvent = spacetimedb.reducer(
  {
    deviceId: t.string(),
    routeId: t.string(),
    eventKey: t.string(),
    impact: t.f64(),
    distanceMm: t.u64(),
    latitude: t.f64(),
    longitude: t.f64(),
  },
  (ctx, event) => {
    if (!event.deviceId.trim() || event.deviceId.length > 80) {
      throw new Error("deviceId must contain 1-80 characters");
    }
    if (!Number.isFinite(event.impact) || event.impact < 0 || event.impact > 100) {
      throw new Error("impact must be between 0 and 100 m/s²");
    }
    const hasNoGps = event.latitude === 0 && event.longitude === 0;
    const hasValidGps =
      Number.isFinite(event.latitude) &&
      Number.isFinite(event.longitude) &&
      event.latitude >= -90 &&
      event.latitude <= 90 &&
      event.longitude >= -180 &&
      event.longitude <= 180;
    if (!hasNoGps && !hasValidGps) {
      throw new Error("latitude/longitude are outside valid GPS bounds");
    }

    ctx.db.roadEvent.insert({
      id: 0n,
      ...event,
      detectedAt: ctx.timestamp,
      risk: event.impact >= 1.5 ? "high" : event.impact >= 0.8 ? "medium" : "low",
      status: "detected",
    });
  },
);

export const deleteEvent = spacetimedb.reducer(
  { eventKey: t.string() },
  (ctx, { eventKey }) => {
    const event = Array.from(ctx.db.roadEvent.iter()).find(
      (candidate) => candidate.eventKey === eventKey,
    );
    if (!event) return;
    ctx.db.roadEvent.delete(event);
  },
);

export const deleteRoute = spacetimedb.reducer(
  { id: t.string() },
  (ctx, { id }) => {
    const route = ctx.db.roadRoute.id.find(id);
    if (!route) throw new Error("route not found");
    for (const event of ctx.db.roadEvent.iter()) {
      if (event.routeId !== id) continue;
      ctx.db.roadEvent.delete(event);
    }
    ctx.db.roadRoute.delete(route);
  },
);

export const updateEventStatus = spacetimedb.reducer(
  { id: t.u64(), status: t.string() },
  (ctx, { id, status }) => {
    if (!["detected", "verified", "resolved"].includes(status)) {
      throw new Error("status must be detected, verified, or resolved");
    }
    const event = ctx.db.roadEvent.id.find(id);
    if (!event) throw new Error(`Road event ${id} does not exist`);
    ctx.db.roadEvent.id.update({ ...event, status });
  },
);
