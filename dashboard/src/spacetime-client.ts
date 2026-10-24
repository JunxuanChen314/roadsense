import { DbConnection, tables } from "./module_bindings";

const SERVER_URL = import.meta.env.VITE_SPACETIMEDB_URL ?? "http://127.0.0.1:3000";
const DATABASE_NAME = import.meta.env.VITE_SPACETIMEDB_DATABASE ?? "roadsense-v3";
const TOKEN_KEY = "roadsense-spacetimedb-token";
const PENDING_KEY = "roadsense-spacetimedb-pending-v1";

type DashboardEvent = {
  id?: string;
  routeId?: string;
  impact: number;
  distance?: number | null;
  lat?: number | null;
  lng?: number | null;
  traveledMm?: number;
  maxTiltDeg?: number;
  severity?: "NORMAL" | "SEVERE";
  eventType?: "DETECTED" | "SUSPECTED";
  waveform?: Array<{ index: number; impact: number }>;
};

type RoadSenseDatabase = {
  connected: boolean;
  recordEvent: (event: DashboardEvent) => void;
  startRoute: (route: { id: string; startDistanceMm: number }) => Promise<void>;
  finishRoute: (id: string) => Promise<void>;
  deleteEvent: (eventKey: string) => Promise<void>;
  deleteRoute: (id: string) => Promise<void>;
};

type SyncedDangerPoint = {
  id: string;
  routeId: string;
  eventKey: string;
  deviceId: string;
  impact: number;
  distance: number;
  lat: number;
  lng: number;
  savedAt: string;
  risk: string;
  status: string;
};

declare global {
  interface Window {
    roadSenseDb: RoadSenseDatabase;
    onRoadSenseDatabaseChange?: (count: number) => void;
    onRoadSenseDatabaseRows?: (points: SyncedDangerPoint[]) => void;
    onRoadSenseBackendRows?: (rows: SyncedDangerPoint[]) => void;
    onRoadSenseDatabaseError?: (message: string) => void;
    onRoadSenseDatabaseDisconnected?: () => void;
  }
}

function setSyncState(label: string, connected: boolean) {
  const element = document.getElementById("syncState");
  if (!element) return;
  element.textContent = label;
  element.parentElement?.classList.toggle("synced", connected);
}

let connection: DbConnection | undefined;
let flushing = false;

function loadPendingEvents(): DashboardEvent[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (event): event is DashboardEvent =>
        typeof event === "object" &&
        event !== null &&
        Number.isFinite(Number((event as DashboardEvent).impact)),
    );
  } catch {
    return [];
  }
}

const pendingEvents = loadPendingEvents();

function savePendingEvents() {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pendingEvents));
}

function updateSyncState() {
  if (!window.roadSenseDb.connected) {
    setSyncState(
      pendingEvents.length
        ? `SpacetimeDB offline · ${pendingEvents.length} pending`
        : "SpacetimeDB disconnected · Reconnecting automatically",
      false,
    );
    return;
  }
  setSyncState(
    pendingEvents.length
      ? `SpacetimeDB connected · Syncing ${pendingEvents.length} records`
      : "SpacetimeDB connected · Live sync",
    true,
  );
}

async function sendEvent(event: DashboardEvent) {
  if (!connection) throw new Error("SpacetimeDB connection is unavailable");
  await connection.reducers.recordEvent({
    deviceId: "roadsense-esp32-01",
    routeId: event.routeId ?? "legacy",
    eventKey: event.id ?? crypto.randomUUID(),
    impact: event.impact,
    distanceMm: BigInt(Math.max(0, Math.round(event.distance ?? 0))),
    latitude: event.lat ?? 0,
    longitude: event.lng ?? 0,
  });
}

async function flushPendingEvents() {
  if (flushing || !connection || !window.roadSenseDb.connected) return;
  flushing = true;
  try {
    while (pendingEvents.length && connection && window.roadSenseDb.connected) {
      await sendEvent(pendingEvents[0]);
      pendingEvents.shift();
      savePendingEvents();
      updateSyncState();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.onRoadSenseDatabaseError?.(`SpacetimeDB write failed: ${message}`);
    updateSyncState();
  } finally {
    flushing = false;
  }
}

function publishSubscribedRows(conn: DbConnection) {
  const rows = Array.from(conn.db.roadEvent.iter());
  const syncedRows = rows
    .sort((a, b) => Number(a.id - b.id))
    .map((row) => ({
      id: row.id.toString(),
      routeId: row.routeId,
      eventKey: row.eventKey,
      deviceId: row.deviceId,
      impact: row.impact,
      distance: Number(row.distanceMm),
      lat: row.latitude,
      lng: row.longitude,
      savedAt: row.detectedAt.toISOString(),
      risk: row.risk,
      status: row.status,
    }));
  window.onRoadSenseDatabaseChange?.(rows.length);
  window.onRoadSenseBackendRows?.(syncedRows);
  window.onRoadSenseDatabaseRows?.(
    syncedRows.filter((row) => row.lat !== 0 || row.lng !== 0),
  );
}

setSyncState("Connecting to SpacetimeDB…", false);
window.roadSenseDb = {
  connected: false,
  recordEvent(event) {
    pendingEvents.push(event);
    savePendingEvents();
    updateSyncState();
    void flushPendingEvents();
  },
  async startRoute(route) {
    if (!connection) throw new Error("SpacetimeDB is not connected");
    await connection.reducers.startRoute({
      id: route.id,
      deviceId: "roadsense-esp32-01",
      startDistanceMm: BigInt(Math.round(route.startDistanceMm)),
    });
  },
  async finishRoute(id) {
    if (!connection) throw new Error("SpacetimeDB is not connected");
    await connection.reducers.finishRoute({ id });
  },
  async deleteEvent(eventKey) {
    if (!connection) throw new Error("SpacetimeDB is not connected");
    await connection.reducers.deleteEvent({ eventKey });
  },
  async deleteRoute(id) {
    if (!connection) throw new Error("SpacetimeDB is not connected");
    await connection.reducers.deleteRoute({ id });
  },
};

const builder = DbConnection.builder()
  .withUri(SERVER_URL)
  .withDatabaseName(DATABASE_NAME)
  .withAutomaticReconnect()
  .onConnect((conn, _identity, token) => {
    connection = conn;
    localStorage.setItem(TOKEN_KEY, token);
    window.roadSenseDb.connected = true;
    updateSyncState();

    conn.db.roadEvent.onInsert(() => publishSubscribedRows(conn));
    conn.db.roadEvent.onUpdate(() => publishSubscribedRows(conn));
    conn.db.roadEvent.onDelete(() => publishSubscribedRows(conn));

    conn.subscriptionBuilder()
      .onApplied(() => {
        publishSubscribedRows(conn);
        void flushPendingEvents();
      })
      .onError((ctx) => {
        const message = ctx.event?.message ?? "unknown subscription error";
        setSyncState(`SpacetimeDB subscription failed: ${message}`, false);
        window.onRoadSenseDatabaseDisconnected?.();
        window.onRoadSenseDatabaseError?.(`SpacetimeDB subscription failed: ${message}`);
      })
      .subscribe([tables.roadEvent, tables.roadRoute]);
  })
  .onDisconnect(() => {
    window.roadSenseDb.connected = false;
    updateSyncState();
    window.onRoadSenseDatabaseDisconnected?.();
  })
  .onConnectError((_ctx, error) => {
    window.roadSenseDb.connected = false;
    setSyncState(`SpacetimeDB connection failed: ${error.message}`, false);
    window.onRoadSenseDatabaseDisconnected?.();
  });

const savedToken = localStorage.getItem(TOKEN_KEY);
if (savedToken) builder.withToken(savedToken);
builder.build();
