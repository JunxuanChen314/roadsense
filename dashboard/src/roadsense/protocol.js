const value = (line, key) => line.match(new RegExp(`\\b${key}=([^\\s]+)`))?.[1];
const number = (line, key) => {
  const parsed = Number(value(line, key));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseDeviceLine(line) {
  if (line.startsWith("[IMPACT] DETECTED")) {
    return {
      type: "impact",
      impact: number(line, "value"),
      distanceMm: number(line, "distance_mm"),
      tiltDeg: number(line, "tilt_deg"),
      severity: value(line, "severity") ?? "NORMAL",
    };
  }

  if (line.startsWith("[MODE]")) {
    return { type: "mode", mode: line.split(" ").at(-1) };
  }

  if (!line.startsWith("DATA ")) return { type: "log", line };

  return {
    type: "data",
    data: {
      mode: value(line, "mode") ?? "IDLE",
      mpu: value(line, "mpu") ?? "WAIT",
      ax: number(line, "ax") ?? 0,
      ay: number(line, "ay") ?? 0,
      az: number(line, "az") ?? 0,
      impact: number(line, "impact") ?? 0,
      tilt: number(line, "tilt") ?? 0,
      vl53: value(line, "vl53") ?? "WAIT",
      distanceMm:
        value(line, "vl53") === "OK" ? number(line, "distance_mm") : null,
      gps: value(line, "gps") ?? "WAIT",
      sats: number(line, "sats") ?? 0,
      lat: number(line, "lat"),
      lng: number(line, "lng"),
      hdop: number(line, "hdop"),
      motor: value(line, "motor") ?? "OFF",
    },
  };
}
