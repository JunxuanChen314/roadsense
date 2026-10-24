import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const checks = [];

function result(ok, name, detail) {
  checks.push({ ok, name, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
}

async function fileCheck(name, relativePath) {
  try {
    await access(path.join(projectRoot, relativePath), constants.R_OK);
    result(true, name, relativePath);
  } catch {
    result(false, name, `Missing ${relativePath}`);
  }
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
result(nodeMajor >= 18, "Node.js", process.version);

const cliCandidates = [
  process.env.SPACETIME_BIN,
  "spacetime",
].filter(Boolean);
let cliFound = false;
let cliPath;
for (const candidate of cliCandidates) {
  try {
    execFileSync(candidate, ["--help"], { stdio: "ignore", timeout: 5000 });
    result(true, "SpacetimeDB CLI", candidate);
    cliFound = true;
    cliPath = candidate;
    break;
  } catch {}
}
if (!cliFound) result(false, "SpacetimeDB CLI", "Not found; check ~/.local/bin/spacetime");

await fileCheck("Generated bindings", "src/module_bindings/index.ts");
await fileCheck("SpacetimeDB module", "spacetimedb/dist/bundle.js");
await fileCheck("Frontend dependencies", "node_modules/vite/bin/vite.js");

try {
  const response = await fetch("http://127.0.0.1:3000/v1/ping", {
    signal: AbortSignal.timeout(1500),
  });
  result(response.ok, "SpacetimeDB service", response.ok ? "localhost:3000 online" : `HTTP ${response.status}`);
} catch {
  result(false, "SpacetimeDB service", "localhost:3000 is not running");
}

if (cliPath) {
  try {
    const raw = execFileSync(
      cliPath,
      [
        "sql",
        "--server",
        "http://127.0.0.1:3000",
        "--anonymous",
        "--yes",
        "--format",
        "json",
        "roadsense-v3",
        "SELECT COUNT(*) AS event_count FROM road_event",
      ],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const eventCount = JSON.parse(raw)[0]?.rows?.[0]?.[0];
    result(true, "roadsense-v3 database", `road_event query succeeded (${eventCount ?? 0} records)`);
  } catch {
    result(false, "roadsense-v3 database", "Unable to query road_event; publish the module again");
  }
}

console.log(
  process.env.ANTHROPIC_API_KEY
    ? "✓ Claude API key: configured (value hidden)"
    : "✗ Claude API key: not configured; integrated route analysis is unavailable",
);

const failed = checks.filter((check) => !check.ok).length;
console.log(`\n${failed === 0 ? "Everything is ready." : `${failed} checks are not ready.`}`);
process.exitCode = failed === 0 ? 0 : 1;
