export const CONFIG = Object.freeze({
  baudRate: 115200,
  tiltThresholdDeg: 8,
  severeTiltDeg: 15,
  warningLeadMm: 30,
  warningPassedMm: 40,
  calibrationSamples: 2,
  maxChartSamples: 90,
  waveformSamples: 20,
});

export const state = {
  workflow: "idle", // idle | calibrating | detecting | ended | warning
  port: null,
  reader: null,
  sensor: {
    mode: "IDLE",
    mpu: "WAIT",
    ax: 0,
    ay: 0,
    az: 0,
    impact: 0,
    tilt: 0,
    vl53: "WAIT",
    distanceMm: null,
    gps: "WAIT",
    sats: 0,
    lat: null,
    lng: null,
    hdop: null,
    motor: "OFF",
  },
  calibration: [],
  chart: Array(CONFIG.maxChartSamples).fill(0),
  activeRoute: null,
};

export function pushChartSample(value) {
  state.chart.push(value);
  if (state.chart.length > CONFIG.maxChartSamples) state.chart.shift();
}
