import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const outputDirectory = path.join(projectRoot, "data");
const spacetimeBinary =
  process.env.SPACETIME_BIN ?? "spacetime";
const serverUrl = process.env.VITE_SPACETIMEDB_URL ?? "http://127.0.0.1:3000";
const databaseName = process.env.VITE_SPACETIMEDB_DATABASE ?? "roadsense-v3";

const query =
  "SELECT id, route_id, event_key, device_id, impact, distance_mm, latitude, longitude, detected_at, risk, status FROM road_event";

function timestampToIso(value) {
  const micros = Array.isArray(value) ? value[0] : value;
  if (!Number.isFinite(micros)) return null;
  return new Date(Math.trunc(micros / 1000)).toISOString();
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeAtomically(targetPath, content) {
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, targetPath);
}

export async function exportRoadEvents() {
  const { stdout } = await execFileAsync(
    spacetimeBinary,
    [
      "sql",
      "--server",
      serverUrl,
      "--anonymous",
      "--yes",
      "--format",
      "json",
      databaseName,
      query,
    ],
    { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 },
  );

  const result = JSON.parse(stdout)[0];
  const columnNames = result.schema.elements.map((column) => column.name.some);
  const events = result.rows.map((values) => {
    const row = Object.fromEntries(columnNames.map((name, index) => [name, values[index]]));
    row.detected_at = timestampToIso(row.detected_at);
    return row;
  });
  const generatedAt = new Date().toISOString();

  await mkdir(outputDirectory, { recursive: true });
  await writeAtomically(
    path.join(outputDirectory, "road-events.json"),
    `${JSON.stringify({ database: databaseName, generatedAt, count: events.length, events }, null, 2)}\n`,
  );

  const csvColumns = columnNames;
  const csv = [
    csvColumns.join(","),
    ...events.map((event) => csvColumns.map((column) => csvCell(event[column])).join(",")),
  ].join("\n");
  await writeAtomically(path.join(outputDirectory, "road-events.csv"), `${csv}\n`);

  return { count: events.length, outputDirectory };
}

export function startRoadEventExporter(intervalMs = 5000) {
  let stopped = false;
  let running = false;

  const update = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await exportRoadEvents();
    } catch (error) {
      console.warn(`[RoadSense export] ${error.message}`);
    } finally {
      running = false;
    }
  };

  void update();
  const timer = setInterval(update, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes("--watch")) {
    startRoadEventExporter();
    console.log(`Continuously exporting ${databaseName} → ${outputDirectory}`);
  } else {
    const result = await exportRoadEvents();
    console.log(`Exported ${result.count} records → ${result.outputDirectory}`);
  }
}
