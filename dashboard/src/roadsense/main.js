import { CONFIG, pushChartSample, state } from "./state.js";
import {
  connectSerial,
  disconnectSerial,
  sendCommand,
  serialSupported,
} from "./serial.js";
import {
  addHazard,
  createRoute,
  findWarning,
  finishRoute,
  loadRoutes,
  markWarned,
  resetWarnings,
  saveRoutes,
} from "./routes.js";
import {
  renderHazards,
  renderRouteHistory,
  renderWarningMonitoring,
  renderSensor,
  renderWorkflow,
  setConnected,
  showWarning,
  toast,
} from "./ui.js";

const el = (id) => document.getElementById(id);
let routes = loadRoutes();

function renderRouteAnalysis(route = state.activeRoute) {
  const analysis = route?.aiAnalysis;
  el("aiRisk").textContent = analysis?.grade ?? "—";
  el("aiConfidence").textContent = analysis ? `${analysis.confidence}%` : "—";
  el("aiSummary").textContent = analysis?.summary ??
    "Complete a route to classify its overall road risk.";
  el("aiPrediction").textContent = analysis?.prediction ??
    "Prediction will appear after route analysis.";
  el("aiBadge").textContent = analysis ? "Analysis saved" : "Waiting for route";
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function persist() {
  saveRoutes(routes);
  renderRouteHistory(routes, selectRoute, deleteRoute, analyzeRoute);
}

function selectRoute(routeId) {
  state.activeRoute = routes.find((route) => route.id === routeId) ?? null;
  state.workflow = state.activeRoute?.endedAt ? "ended" : "idle";
  renderWorkflow();
  renderHazards(deleteHazard);
  renderSensor();
  renderRouteAnalysis();
  renderRouteHistory(routes, selectRoute, deleteRoute, analyzeRoute);
  renderRouteAnalysis();
}

async function deleteRoute(routeId) {
  if (!confirm("Permanently delete this route and all of its impact records?")) return;
  routes = routes.filter((route) => route.id !== routeId);
  if (state.activeRoute?.id === routeId) {
    state.activeRoute = routes.at(-1) ?? null;
    state.workflow = state.activeRoute?.endedAt ? "ended" : "idle";
  }
  persist();
  renderWorkflow();
  renderHazards(deleteHazard);
  renderSensor();
  try {
    await window.roadSenseDb?.deleteRoute(routeId);
  } catch (error) {
    console.warn("The backend route could not be deleted", error);
  }
}

function beginCalibration() {
  if (!state.port) {
    toast("Connect the ESP32 first");
    return;
  }
  if (state.sensor.distanceMm === null) {
    toast("VL53 has not detected the reference board. Check its distance and alignment.");
    return;
  }
  state.workflow = "calibrating";
  renderRouteAnalysis(null);
  // Lock the route origin at the instant the user presses Start. The ESP32
  // spends about one second calibrating its MPU after the command, so waiting
  // for a later distance sample can accidentally record a moving vehicle near
  // the end of the route as the starting point.
  state.calibration = [state.sensor.distanceMm];
  renderWorkflow();
  el("mapHint").textContent = `Start locked at ${(state.calibration[0] / 10).toFixed(1)} cm · Calibrating sensors…`;
  void sendCommand("S");
}

async function completeCalibration() {
  const startDistanceMm = state.calibration[0];
  const route = createRoute(startDistanceMm);
  routes.push(route);
  state.activeRoute = route;
  state.workflow = "detecting";
  persist();
  renderRouteAnalysis(route);
  try {
    await window.roadSenseDb?.startRoute(route);
  } catch (error) {
    console.warn("The route could not be synchronized to SpacetimeDB", error);
  }
  state.sensor.mode = "DETECTION";
  renderWorkflow();
  renderHazards(deleteHazard);
  toast(`Calibration complete: ${(startDistanceMm / 10).toFixed(1)} cm route. Ready to go.`);
}

async function endDetection() {
  finishRoute(state.activeRoute);
  state.workflow = "ended";
  persist();
  try {
    await window.roadSenseDb?.finishRoute(state.activeRoute.id);
  } catch (error) {
    console.warn("The completed route status could not be synchronized", error);
  }
  await sendCommand("E");
  state.sensor.mode = "IDLE";
  renderWorkflow();
  renderHazards(deleteHazard);
  toast(`Detection complete: ${state.activeRoute.hazards.length} impact points recorded`);
}

async function enterWarningMode() {
  if (!state.activeRoute?.endedAt) {
    toast("Complete a detection route first");
    return;
  }
  if (!state.activeRoute.hazards.length) {
    toast("This route has no hazards to warn about");
    return;
  }
  resetWarnings(state.activeRoute);
  state.workflow = "warning";
  state.sensor.mode = "WARNING";
  persist();
  await sendCommand("W");
  renderWorkflow();
  renderWarningMonitoring(0, state.activeRoute.hazards.length);
  toast("Warning mode enabled. Return the vehicle to the same starting point.");
}

async function endWarningMode() {
  if (!state.activeRoute) return;
  state.workflow = "ended";
  state.sensor.mode = "IDLE";
  await sendCommand("E");
  persist();
  renderWorkflow();
  renderWarningMonitoring(
    state.activeRoute.warnedHazardIds.length,
    state.activeRoute.hazards.length,
  );
  toast("Warning ended.");
}

async function deleteHazard(hazardId) {
  if (!state.activeRoute || !confirm("Delete this false detection?")) return;
  state.activeRoute.hazards = state.activeRoute.hazards.filter(
    (hazard) => hazard.id !== hazardId,
  );
  delete state.activeRoute.aiAnalysis;
  try {
    await window.roadSenseDb?.deleteEvent(hazardId);
  } catch (error) {
    console.warn("The backend record could not be deleted", error);
  }
  persist();
  renderHazards(deleteHazard);
  renderSensor();
}

function waveformSnapshot() {
  return state.chart.slice(-CONFIG.waveformSamples).map((impact, index) => ({
    index,
    impact,
  }));
}

function eventSnapshot(message) {
  return {
    ...state.sensor,
    impact: message.impact ?? state.sensor.impact,
    distanceMm: message.distanceMm || state.sensor.distanceMm,
  };
}

function eventDetails(message, eventType) {
  return {
    maxTiltDeg: message.tiltDeg ?? state.sensor.tilt,
    severity: message.severity ?? "NORMAL",
    eventType,
    waveform: waveformSnapshot(),
  };
}

function syncHazard(hazard) {
  window.roadSenseDb?.recordEvent({
    id: hazard.id,
    impact: hazard.impact,
    distance: hazard.distanceMm,
    lat: hazard.lat,
    lng: hazard.lng,
    routeId: state.activeRoute.id,
    traveledMm: hazard.traveledMm,
    maxTiltDeg: hazard.maxTiltDeg,
    severity: hazard.severity,
    eventType: hazard.eventType,
    waveform: hazard.waveform,
  });
}

function recordImpact(message) {
  if (state.workflow !== "detecting" || !state.activeRoute) return;
  if (state.sensor.distanceMm === null) {
    toast("Impact detected, but the VL53 distance is invalid. Position was not saved.");
    return;
  }
  const hazard = addHazard(
    state.activeRoute,
    eventSnapshot(message),
    eventDetails(message, "DETECTED"),
  );
  persist();
  renderHazards(deleteHazard);
  renderSensor();
  syncHazard(hazard);
  toast(`Impact recorded: ${(hazard.traveledMm / 10).toFixed(1)} cm from start`);
}

async function checkWarning() {
  if (state.workflow !== "warning" || state.sensor.distanceMm === null) return;
  const hazard = findWarning(state.activeRoute, state.sensor.distanceMm);
  if (!hazard) {
    renderWarningMonitoring(
      state.activeRoute.warnedHazardIds.length,
      state.activeRoute.hazards.length,
    );
    return;
  }
  markWarned(state.activeRoute, hazard);
  persist();
  const position = state.activeRoute.hazards.indexOf(hazard) + 1;
  showWarning(hazard, position, state.activeRoute.hazards.length);
  await sendCommand("A");
  toast(`Hazard about 3 cm ahead · Vibration alert ${position}/${state.activeRoute.hazards.length}`);
  setTimeout(() => {
    if (state.workflow === "warning") {
      renderWarningMonitoring(
        state.activeRoute.warnedHazardIds.length,
        state.activeRoute.hazards.length,
      );
    }
  }, 1800);
}

function acceptData(data) {
  Object.assign(state.sensor, data);
  pushChartSample(data.impact);

  if (state.workflow === "calibrating" && data.distanceMm !== null) {
    state.calibration.push(data.distanceMm);
    el("mapHint").textContent = `Calibrating start point ${state.calibration.length}/${CONFIG.calibrationSamples}`;
    if (state.calibration.length >= CONFIG.calibrationSamples) {
      void completeCalibration();
    }
  }

  renderSensor();
  void checkWarning();
}

function handleDeviceMessage(message) {
  if (message.type === "data") acceptData(message.data);
  if (message.type === "impact") recordImpact(message);
  if (message.type === "mode") {
    state.sensor.mode = message.mode;
    if (message.mode === "WARNING" && state.activeRoute?.endedAt) {
      resetWarnings(state.activeRoute);
      state.workflow = "warning";
    }
    renderWorkflow();
  }
}

async function toggleConnection() {
  if (state.port) {
    await disconnectSerial();
    setConnected(false);
    return;
  }
  if (!serialSupported()) {
    toast("Open this page in Chrome or Edge");
    return;
  }
  try {
    await connectSerial(handleDeviceMessage, () => setConnected(false));
    setConnected(true);
  } catch (error) {
    if (error.name !== "NotFoundError") toast(`Connection failed: ${error.message}`);
  }
}

async function analyzeRoute(routeId = state.activeRoute?.id) {
  const route = routes.find((item) => item.id === routeId);
  if (!route?.endedAt) {
    toast("Finish this route before analyzing it");
    return;
  }
  if (state.activeRoute?.id !== route.id) selectRoute(route.id);
  const impacts = route.hazards.map((item) => item.impact);
  const positionsCm = route.hazards.map((item) => Number((item.traveledMm / 10).toFixed(1)));
  el("analyzeButton").disabled = true;
  el("analyzeButton").textContent = "Claude is analyzing…";
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        routeLengthCm: route.startDistanceMm / 10,
        hazardCount: route.hazards.length,
        maxImpact: impacts.length ? Math.max(...impacts) : 0,
        averageImpact: impacts.length
          ? impacts.reduce((sum, value) => sum + value, 0) / impacts.length
          : 0,
        positionsCm,
        hazards: route.hazards.map((item) => ({
          impact: item.impact,
          traveledCm: Number((item.traveledMm / 10).toFixed(1)),
        })),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    route.aiAnalysis = result;
    persist();
    renderRouteAnalysis(route);
    el("aiBadge").textContent = "Claude analysis saved";
  } catch (error) {
    el("aiSummary").textContent = error.message;
    el("aiPrediction").textContent = "No prediction was generated.";
    el("aiBadge").textContent = error.message.includes("key")
      ? "API key required"
      : "Analysis failed";
  } finally {
    el("analyzeButton").textContent = "Analyze This Route";
    el("analyzeButton").disabled = false;
  }
}

el("connectButton").addEventListener("click", toggleConnection);
el("routeButton").addEventListener("click", () => {
  if (state.workflow === "detecting") void endDetection();
  else if (state.workflow === "warning") void endWarningMode();
  else beginCalibration();
});
el("detectionTab").addEventListener("click", () => {
  state.sensor.mode = "DETECTION";
  void sendCommand("D");
  renderWorkflow();
});
el("warningTab").addEventListener("click", enterWarningMode);
el("clearEvents").addEventListener("click", () => {
  if (!state.activeRoute || !confirm("Delete all false detections from the current route?")) return;
  state.activeRoute.hazards = [];
  delete state.activeRoute.aiAnalysis;
  persist();
  renderHazards(deleteHazard);
  renderSensor();
});
el("analyzeButton").addEventListener("click", () => analyzeRoute());
window.addEventListener("resize", renderSensor);

// Existing SpacetimeDB client calls these hooks after each realtime update.
window.onRoadSenseBackendRows = (rows) => {
  el("databaseTotal").textContent = String(rows.length);
  el("databaseHighRisk").textContent = String(rows.filter((row) => row.risk === "high").length);
  el("databaseUpdatedAt").textContent = new Date().toLocaleTimeString("en-US", { hour12: false });
  el("databaseBadge").textContent = "Live Sync";
  el("databaseBadge").classList.add("online");
  el("databaseRows").innerHTML = rows.slice().reverse().slice(0, 8).map((row) => `<tr><td>${new Date(row.savedAt).toLocaleTimeString("en-US", { hour12: false })}</td><td>${row.deviceId}</td><td>${row.impact.toFixed(2)} m/s²</td><td>${row.distance} mm</td><td>${row.lat || row.lng ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}` : "No location"}</td><td>${{ high: "High", medium: "Medium", low: "Low" }[row.risk]}</td></tr>`).join("") || '<tr><td colspan="6" class="database-empty">No database records</td></tr>';
};

window.onRoadSenseDatabaseDisconnected = () => {
  el("databaseTotal").textContent = "—";
  el("databaseHighRisk").textContent = "—";
  el("databaseUpdatedAt").textContent = "—";
  el("databaseBadge").textContent = "Backend Unavailable";
  el("databaseBadge").classList.remove("online");
  el("databaseRows").innerHTML = '<tr><td colspan="6" class="database-empty">Connect to SpacetimeDB to load backend records</td></tr>';
};

window.onRoadSenseDatabaseError = (message) => {
  console.error(message);
  el("databaseBadge").textContent = "Connection Error";
};

state.activeRoute = routes.at(-1) ?? null;
state.workflow = state.activeRoute?.endedAt ? "ended" : "idle";
setConnected(false);
renderWorkflow();
renderHazards(deleteHazard);
renderRouteHistory(routes, selectRoute, deleteRoute, analyzeRoute);
renderSensor();
renderRouteAnalysis();

fetch("/api/claude-status")
  .then((response) => response.json())
  .then(({ configured }) => {
    if (!configured && !state.activeRoute?.aiAnalysis) {
      el("aiBadge").textContent = "API key required";
    }
  })
  .catch(() => {
    if (!state.activeRoute?.aiAnalysis) el("aiBadge").textContent = "API unavailable";
  });
