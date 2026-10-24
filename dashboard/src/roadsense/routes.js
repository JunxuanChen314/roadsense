import { CONFIG } from "./state.js";

const STORAGE_KEY = "roadsense-routes-clean-v1";

export function loadRoutes() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveRoutes(routes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

export function createRoute(startDistanceMm) {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    startDistanceMm,
    hazards: [],
    warnedHazardIds: [],
  };
}

export function addHazard(route, sensor, details = {}) {
  const hazard = {
    id: crypto.randomUUID(),
    detectedAt: new Date().toISOString(),
    distanceMm: sensor.distanceMm,
    traveledMm: route.startDistanceMm - sensor.distanceMm,
    impact: sensor.impact,
    maxTiltDeg: details.maxTiltDeg ?? sensor.tilt ?? 0,
    severity: details.severity ?? "NORMAL",
    eventType: details.eventType ?? "DETECTED",
    waveform: details.waveform ?? [],
    lat: sensor.lat,
    lng: sensor.lng,
  };
  route.hazards.push(hazard);
  return hazard;
}

export function finishRoute(route) {
  route.endedAt = new Date().toISOString();
}

export function findWarning(route, currentDistanceMm) {
  return route.hazards.find((hazard) => {
    if (route.warnedHazardIds.includes(hazard.id)) return false;
    const warningDistance = hazard.distanceMm + CONFIG.warningLeadMm;
    return (
      currentDistanceMm <= warningDistance &&
      currentDistanceMm >= hazard.distanceMm - CONFIG.warningPassedMm
    );
  });
}

export function markWarned(route, hazard) {
  route.warnedHazardIds.push(hazard.id);
}

export function resetWarnings(route) {
  route.warnedHazardIds = [];
}
