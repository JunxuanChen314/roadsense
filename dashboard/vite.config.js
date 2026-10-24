import { defineConfig, loadEnv } from "vite";
import { startRoadEventExporter } from "./scripts/export-data.mjs";

function claudeApiPlugin(env) {
  const sendJson = (response, statusCode, payload) => {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(payload));
  };

  return {
    name: "roadsense-claude-api",
    configureServer(server) {
      const stopExporter = startRoadEventExporter();
      server.httpServer?.once("close", stopExporter);

      server.middlewares.use("/api/claude-status", (_request, response) => {
        sendJson(response, 200, {
          configured: Boolean(env.ANTHROPIC_API_KEY),
          model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        });
      });

      server.middlewares.use("/api/analyze", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }

        const apiKey = env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          sendJson(response, 503, { error: "Claude API key is not configured" });
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const route = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (
            !Array.isArray(route.hazards) ||
            !Number.isFinite(Number(route.maxImpact)) ||
            !Number.isFinite(Number(route.averageImpact))
          ) {
            sendJson(response, 400, { error: "Valid completed route data is required" });
            return;
          }

          const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

          const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              "content-type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: 600,
              system:
                "You are a road-safety analyst for a small tabletop road-monitoring vehicle. Analyze the complete route, not a single event. Use only the supplied hazard count, maximum and average vertical impact, traveled positions, spacing, and route length. Grade A means high risk, B means moderate risk, and C means low risk. A completed route with zero detected impacts must receive grade C. This is a repeatable tabletop demo, so judge severity relative to the measured route rather than real-car standards. A route with several strong or densely grouped impacts should rank above one with a single weak impact. Predictions must be cautious and must describe what is likely on a repeat pass, not invent future measurements.",
              messages: [
                {
                  role: "user",
                  content: `Analyze this completed route: ${JSON.stringify(route)}`,
                },
              ],
              tools: [
                {
                  name: "submit_route_assessment",
                  description: "Return the final structured assessment for the completed route.",
                  input_schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      grade: { type: "string", enum: ["A", "B", "C"] },
                      confidence: { type: "integer", minimum: 0, maximum: 100 },
                      summary: { type: "string" },
                      prediction: { type: "string" },
                    },
                    required: ["grade", "confidence", "summary", "prediction"],
                  },
                },
              ],
              tool_choice: { type: "tool", name: "submit_route_assessment" },
            }),
          });

          const payload = await claudeResponse.json();
          if (!claudeResponse.ok) {
            throw new Error(payload?.error?.message || "Claude API request failed");
          }

          const analysis = payload.content?.find(
            (item) => item.type === "tool_use" && item.name === "submit_route_assessment",
          )?.input;
          if (
            !analysis ||
            !["A", "B", "C"].includes(analysis.grade) ||
            !Number.isInteger(analysis.confidence) ||
            analysis.confidence < 0 ||
            analysis.confidence > 100 ||
            typeof analysis.summary !== "string" ||
            !analysis.summary.trim() ||
            typeof analysis.prediction !== "string" ||
            !analysis.prediction.trim()
          ) {
            throw new Error("Claude returned an invalid data format");
          }
          sendJson(response, 200, {
            ...analysis,
            model,
            analyzedAt: new Date().toISOString(),
          });
        } catch (error) {
          sendJson(response, 500, { error: error.message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return { plugins: [claudeApiPlugin(env)] };
});
