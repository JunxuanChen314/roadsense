import { CONFIG, state } from "./state.js";

const el = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function toast(message) {
  el("toast").textContent = message;
  el("toast").classList.add("show");
  setTimeout(() => el("toast").classList.remove("show"), 2400);
}

export function setConnected(connected) {
  el("connectionBadge").className = `badge ${connected ? "online" : "neutral"}`;
  el("connectionBadge").innerHTML = `<i></i>${connected ? "ESP32 connected" : "Device disconnected"}`;
  el("connectButton").textContent = connected ? "Disconnect" : "Connect ESP32";
  el("deviceState").textContent = connected ? "Online" : "Disconnected";
}

export function renderWorkflow() {
  const labels = {
    idle: "Start Detection",
    calibrating: "Calibrating…",
    detecting: "End Detection",
    ended: "Start New Route",
    warning: "End Warning",
  };
  const button = el("routeButton");
  button.textContent = labels[state.workflow];
  button.disabled = state.workflow === "calibrating";
  button.classList.toggle("running", state.workflow === "detecting");
  el("detectionTab").classList.toggle("active", state.sensor.mode === "DETECTION");
  el("warningTab").classList.toggle("active", state.sensor.mode === "WARNING");
}

export function renderSensor() {
  const s = state.sensor;
  el("lastUpdate").textContent = `Last updated ${new Date().toLocaleTimeString("en-US", { hour12: false })}`;
  el("impactValue").textContent = s.impact.toFixed(2);
  el("distanceValue").textContent = s.distanceMm ?? "—";
  el("distanceState").textContent = s.distanceMm === null
    ? "Distance signal lost"
    : "Reference board tracking active";
  el("mpuHealth").textContent = s.mpu === "OK" ? "Normal" : "Error";
  el("vl53Health").textContent = s.vl53 === "OK" ? "Normal" : "Invalid";
  el("gpsHealth").textContent = s.gps === "FIX" ? "Fixed" : s.gps === "STALE" ? "Stale" : "Searching";
  el("motorHealth").textContent = s.motor === "ON" ? "Vibrating" : "Ready";
  el("gpsState").textContent = `GPS ${s.sats} satellites${s.hdop === null ? "" : ` · HDOP ${s.hdop.toFixed(1)}`}`;
  el("coordinateText").textContent = s.lat === null ? "Approximate GPS: --, --" : `Approximate GPS: ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`;
  el("rawAx").textContent = s.ax.toFixed(2);
  el("rawAy").textContent = s.ay.toFixed(2);
  el("rawAz").textContent = s.az.toFixed(2);
  el("rawDistance").textContent = s.distanceMm === null ? "—" : `${s.distanceMm} mm`;
  el("rawSats").textContent = String(s.sats);
  el("rawHdop").textContent = s.hdop === null ? "—" : s.hdop.toFixed(1);
  renderMap();
  drawChart();
}

function mapPercent(distanceMm) {
  const start = state.activeRoute?.startDistanceMm;
  if (!start || distanceMm === null) return 10;
  return 10 + clamp((start - distanceMm) / start, 0, 1) * 80;
}

export function renderMap() {
  const route = state.activeRoute;
  const vehiclePercent = mapPercent(state.sensor.distanceMm);
  el("vehicle").style.left = `${vehiclePercent}%`;
  el("vehicle").style.top = "50%";
  el("routeLine").setAttribute("points", `100,260 ${vehiclePercent * 10},260`);
  document.querySelectorAll(".event-pin").forEach((node) => node.remove());

  if (!route) return;
  route.hazards.forEach((hazard) => {
    const pin = document.createElement("i");
    pin.className = "event-pin";
    pin.dataset.hazardId = hazard.id;
    pin.style.left = `${mapPercent(hazard.distanceMm)}%`;
    pin.style.top = "50%";
    pin.title = `${(hazard.traveledMm / 10).toFixed(1)} cm from start · Impact ${hazard.impact.toFixed(2)}`;
    el("map").append(pin);
  });

  const boardDistance = state.sensor.distanceMm ?? route.startDistanceMm;
  const traveled = route.startDistanceMm - boardDistance;
  el("mapHint").textContent = `Traveled ${Math.max(0, traveled / 10).toFixed(1)} cm · Board ${(boardDistance / 10).toFixed(1)} cm`;
  renderScale(route.startDistanceMm);
}

function renderScale(lengthMm) {
  const scale = el("distanceScale");
  scale.innerHTML = "";
  for (let index = 0; index <= 4; index += 1) {
    const tick = document.createElement("span");
    tick.className = "distance-tick";
    tick.style.left = `${index * 25}%`;
    tick.textContent = `${Math.round((lengthMm / 10) * (index / 4))} cm`;
    scale.append(tick);
  }
}

export function renderHazards(onDelete) {
  const hazards = state.activeRoute?.hazards ?? [];
  el("eventCount").textContent = String(hazards.length);
  el("eventList").innerHTML = hazards.length ? "" : '<div class="empty">No impacts detected on this run</div>';
  hazards.slice().reverse().forEach((hazard) => {
    const row = document.createElement("div");
    row.className = "event-row";
    row.innerHTML = `<span class="event-symbol">!</span><div><strong>Road Impact</strong><small>${(hazard.traveledMm / 10).toFixed(1)} cm from start · ${(hazard.distanceMm / 10).toFixed(1)} cm from board</small></div><span>${hazard.impact.toFixed(2)}</span><button title="Delete false detection">Delete</button>`;
    row.querySelector("button").addEventListener("click", () => onDelete(hazard.id));
    el("eventList").append(row);
  });
  el("analyzeButton").disabled = state.workflow !== "ended";
}

export function renderRouteHistory(routes, onSelect, onDelete, onAnalyze) {
  const container = el("routeHistory");
  container.innerHTML = routes.length ? "" : '<div class="empty">No route history</div>';
  routes.slice().reverse().forEach((route, reverseIndex) => {
    const row = document.createElement("div");
    row.className = `route-history-row ${route.id === state.activeRoute?.id ? "active" : ""}`;
    const routeNumber = routes.length - reverseIndex;
    const analysisLabel = route.aiAnalysis ? `Grade ${route.aiAnalysis.grade}` : "Analyze";
    row.innerHTML = `<div><strong>Route #${routeNumber}</strong><small>${new Date(route.startedAt).toLocaleString("en-US")} · ${(route.startDistanceMm / 10).toFixed(1)} cm · ${route.hazards.length} impacts</small></div><button class="view">View</button><button class="analyze-history" ${route.endedAt ? "" : "disabled"}>${analysisLabel}</button><button class="danger">Delete</button>`;
    row.querySelector(".view").addEventListener("click", () => onSelect(route.id));
    row.querySelector(".analyze-history").addEventListener("click", () => onAnalyze(route.id));
    row.querySelector(".danger").addEventListener("click", () => onDelete(route.id));
    container.append(row);
  });
}

export function showWarning(hazard, position, total) {
  el("statusPanel").classList.add("warning", "warning-flash");
  el("roadStatus").textContent = `Impact Ahead ${position}/${total}`;
  el("roadMessage").textContent = "About 3 cm ahead · Saved hazard · One vibration";
  setTimeout(() => el("statusPanel").classList.remove("warning-flash"), 1200);
}

export function renderWarningMonitoring(warned, total) {
  el("statusPanel").classList.remove("warning");
  el("roadStatus").textContent = "Warning Active";
  el("roadMessage").textContent = warned >= total
    ? `All ${total} saved hazards reported · Still monitoring until you end warning`
    : `${warned}/${total} reported · Monitoring the next hazard`;
}

export function drawChart() {
  const canvas = el("impactChart");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = devicePixelRatio || 1;
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);
  const maximum = Math.max(2, ...state.chart);
  context.beginPath();
  state.chart.forEach((sample, index) => {
    const x = (index / (state.chart.length - 1)) * rect.width;
    const y = rect.height - 8 - (sample / maximum) * (rect.height - 16);
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.strokeStyle = "#1677ff";
  context.lineWidth = 2.5;
  context.stroke();
  el("peakValue").textContent = `Peak ${Math.max(...state.chart).toFixed(2)}`;
}
