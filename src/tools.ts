import { defineTool, type ToolContext } from "@barry/tools";
import { z } from "zod";
import { LogsService } from "./logs-service.js";

export { LogsService } from "./logs-service.js";

// Cache the service per API key (secrets are resolved per-profile and re-resolved
// per turn, so rebuild only when the key actually changes).
let logsService: LogsService | null = null;
let serviceKey: string | null = null;

function getService(context?: ToolContext): LogsService {
  const token = context?.secrets.AXIOM_TOKEN;
  if (!token) {
    throw new Error("AXIOM_TOKEN not set — add it to the active profile's secrets");
  }
  if (!logsService || serviceKey !== token) {
    logsService = new LogsService(token);
    serviceKey = token;
  }
  return logsService;
}

export const logsSearch = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "search",
  description: `Search Barry service logs by text, service, level, and time range.

Use this to find application logs, errors, and debug information across Barry services.

Examples:
- Find errors: level "error"
- Filter by service: service "barry-works"
- Search text: query "connection refused"
- Combine: service "barry-server", level "error", query "timeout"`,
  schema: {
    query: z.string().optional().describe("Text to search for in log messages"),
    service: z.string().optional().describe("Filter to a specific service name"),
    level: z
      .enum(["debug", "info", "warn", "error"])
      .optional()
      .describe("Filter by log level"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Time window: 15m, 1h, 6h, 24h, 7d, etc. (default: 1h)"),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(50)
      .describe("Maximum number of logs to return (default: 50)"),
  },
  handler: async ({ query, service, level, timeframe, limit }, context) => {
    const svc = getService(context);
    const result = await svc.searchLogs({ query, service, level, timeframe, limit });
    return {
      summary: `Found ${result.matches.length} logs (${result.status.rowsMatched} total matches)`,
      filters: { query, service, level, timeframe },
      logs: result.matches,
    };
  },
  cliFormat: (result) => {
    const r = result as { summary: string; logs: Array<{ _time?: string; level?: string; service?: string; message?: string }> };
    if (!r.logs.length) return "No logs found.";
    const lines = r.logs.map((l) => {
      const ts = l._time ? new Date(l._time).toLocaleTimeString() : "";
      return `[${ts}] ${l.level ?? ""} ${l.service ?? ""}: ${l.message ?? ""}`;
    });
    return `${r.summary}\n\n${lines.join("\n")}`;
  },
});

export const logsQuery = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "query",
  description: `Run a raw APL query against Barry log datasets. For power users who know APL syntax.

APL is a Kusto-like query language. Queries start with the dataset name in brackets.

Examples:
- ['barry'] | where level == 'error' | take 10
- ['barry'] | where service == 'barry-works' | summarize count() by level
- ['barry_network'] | where hostname contains 'api' | take 20
- ['barry'] | summarize count() by bin(_time, 5m), service`,
  schema: {
    apl: z.string().describe("The APL query to execute"),
    startTime: z.string().optional().describe("ISO 8601 start time (e.g. 2026-05-01T00:00:00Z)"),
    endTime: z.string().optional().describe("ISO 8601 end time (e.g. 2026-05-02T00:00:00Z)"),
  },
  handler: async ({ apl, startTime, endTime }, context) => {
    const svc = getService(context);
    const result = await svc.query(apl, { startTime, endTime });
    return {
      apl,
      matches: result.matches,
      status: result.status,
      buckets: result.buckets,
    };
  },
});

export const logsTail = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "tail",
  description:
    "View the most recent Barry logs, like tail -f. Quick way to see what is happening right now.",
  schema: {
    service: z.string().optional().describe("Filter to a specific service"),
    level: z
      .enum(["debug", "info", "warn", "error"])
      .optional()
      .describe("Filter by log level"),
    minutes: z
      .number()
      .min(1)
      .max(60)
      .default(5)
      .describe("How many minutes back to look (default: 5)"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of recent entries (default: 20)"),
  },
  handler: async ({ service, level, minutes, limit }, context) => {
    const svc = getService(context);
    const result = await svc.tailLogs({ service, level, minutes, limit });
    return {
      summary: `${result.matches.length} logs from the last ${minutes} minutes`,
      filters: { service, level },
      logs: result.matches,
    };
  },
  cliFormat: (result) => {
    const r = result as { summary: string; logs: Array<{ _time?: string; level?: string; service?: string; message?: string }> };
    if (!r.logs.length) return "No recent logs.";
    const lines = r.logs.map((l) => {
      const ts = l._time ? new Date(l._time).toLocaleTimeString() : "";
      return `[${ts}] ${l.level ?? ""} ${l.service ?? ""}: ${l.message ?? ""}`;
    });
    return `${r.summary}\n\n${lines.join("\n")}`;
  },
});

export const logsAggregate = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "aggregate",
  description: `Get aggregate statistics from Barry logs.

Available metrics:
- count: Total log count over time
- error_count: Error count over time
- error_rate: Ratio of errors to total logs over time
- volume_over_time: Log volume over time (same as count)
- top_services: Services ranked by log volume
- top_messages: Most common error messages`,
  schema: {
    metric: z
      .enum(["count", "error_count", "error_rate", "volume_over_time", "top_services", "top_messages"])
      .describe("What to measure"),
    service: z.string().optional().describe("Filter to a specific service"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Time window (default: 1h)"),
    bin_size: z
      .string()
      .optional()
      .describe("Time bucket size for time-series (e.g. 5m, 1h). Auto-calculated if omitted."),
  },
  handler: async ({ metric, service, timeframe, bin_size }, context) => {
    const svc = getService(context);
    const result = await svc.aggregateLogs({ metric, service, timeframe, binSize: bin_size });
    return {
      summary: `Aggregate: ${metric}`,
      filters: { metric, service, timeframe, bin_size },
      data: result.matches,
      buckets: result.buckets,
      status: result.status,
    };
  },
});

export const logsContext = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "context",
  description:
    "Given a timestamp and optional service, find surrounding log entries. Useful for understanding what happened before and after a specific event.",
  schema: {
    timestamp: z
      .string()
      .describe("ISO 8601 timestamp of the log entry of interest"),
    service: z.string().optional().describe("Service to scope the context to"),
    window_minutes: z
      .number()
      .min(1)
      .max(30)
      .default(2)
      .describe("Minutes before and after to include (default: 2)"),
    limit: z
      .number()
      .min(1)
      .max(200)
      .default(50)
      .describe("Max results (default: 50)"),
  },
  handler: async ({ timestamp, service, window_minutes, limit }, context) => {
    const svc = getService(context);
    const result = await svc.getLogContext({
      timestamp,
      service,
      windowMinutes: window_minutes,
      limit,
    });
    return {
      summary: `${result.matches.length} logs within ${window_minutes}m of ${timestamp}`,
      center: timestamp,
      service,
      logs: result.matches,
    };
  },
});

export const logsServices = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "services",
  description:
    "List known services that have sent logs recently. Useful for discovering what services exist and their activity levels.",
  schema: {
    timeframe: z
      .string()
      .default("24h")
      .describe("How far back to look for services (default: 24h)"),
  },
  handler: async ({ timeframe }, context) => {
    const svc = getService(context);
    const result = await svc.listServices(timeframe);
    return {
      summary: `Found ${result.matches.length} services`,
      timeframe,
      services: result.matches,
    };
  },
  cliFormat: (result) => {
    const r = result as { summary: string; services: Array<{ service?: string; _count?: number }> };
    if (!r.services.length) return "No services found.";
    return `${r.summary}\n\n${r.services.map((s) => `  ${s.service ?? "unknown"}${s._count ? ` (${s._count} logs)` : ""}`).join("\n")}`;
  },
});

export const logsDatasets = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "datasets",
  description: "List available Barry log datasets.",
  schema: {},
  handler: async (_params, context) => {
    const svc = getService(context);
    const datasets = await svc.listDatasets();
    return {
      summary: `${datasets.length} datasets available`,
      datasets,
    };
  },
  cliFormat: (result) => {
    const r = result as { summary: string; datasets: Array<{ name?: string; description?: string }> };
    if (!r.datasets.length) return "No datasets.";
    return `${r.summary}\n\n${r.datasets.map((d) => `  ${d.name ?? "unknown"}${d.description ? ` — ${d.description}` : ""}`).join("\n")}`;
  },
});

export const logsNetworkSearch = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "network_search",
  description:
    "Search Barry network and firewall logs. These track network connections, blocked traffic, and firewall events.",
  schema: {
    query: z.string().optional().describe("Text to search in network log messages"),
    event_type: z
      .string()
      .optional()
      .describe('Filter by network event type (e.g. "pf")'),
    hostname: z.string().optional().describe("Filter by hostname"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Time window (default: 1h)"),
    limit: z
      .number()
      .min(1)
      .max(500)
      .default(50)
      .describe("Max results (default: 50)"),
  },
  handler: async ({ query, event_type, hostname, timeframe, limit }, context) => {
    const svc = getService(context);
    const result = await svc.searchNetworkLogs({
      query,
      eventType: event_type,
      hostname,
      timeframe,
      limit,
    });
    return {
      summary: `Found ${result.matches.length} network logs`,
      filters: { query, event_type, hostname, timeframe },
      logs: result.matches,
    };
  },
});

export const logsNetworkStats = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "network_stats",
  description: `Get aggregate statistics from Barry network logs.

Available metrics:
- count: Network event count over time
- volume_over_time: Network log volume over time
- top_hostnames: Hostnames ranked by event count
- event_types: Breakdown by network event type`,
  schema: {
    metric: z
      .enum(["count", "volume_over_time", "top_hostnames", "event_types"])
      .describe("What to measure"),
    timeframe: z
      .string()
      .default("1h")
      .describe("Time window (default: 1h)"),
  },
  handler: async ({ metric, timeframe }, context) => {
    const svc = getService(context);
    const result = await svc.networkStats({ metric, timeframe });
    return {
      summary: `Network stats: ${metric}`,
      filters: { metric, timeframe },
      data: result.matches,
      buckets: result.buckets,
      status: result.status,
    };
  },
});

export const logsStatus = defineTool({
  namespace: "logs",
  access: "read",
  secrets: ["AXIOM_TOKEN"],
  name: "status",
  description:
    "Check if the Barry log service is configured and connected. Validates credentials and lists available capabilities.",
  schema: {},
  handler: async (_params, context) => {
    const hasToken = !!context?.secrets.AXIOM_TOKEN;

    let connected = false;
    let error: string | null = null;

    if (hasToken) {
      try {
        connected = await getService(context).validate();
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      status: connected ? "connected" : "disconnected",
      configuration: {
        AXIOM_TOKEN: hasToken ? "configured" : "missing",
      },
      error,
      capabilities: {
        search: connected,
        query: connected,
        tail: connected,
        aggregate: connected,
        context: connected,
        services: connected,
        datasets: connected,
        network: connected,
      },
    };
  },
  cliFormat: (result) => {
    const r = result as { status: string; configuration: Record<string, string>; error: string | null };
    const lines = [`Status: ${r.status}`];
    for (const [k, v] of Object.entries(r.configuration)) lines.push(`  ${k}: ${v}`);
    if (r.error) lines.push(`Error: ${r.error}`);
    return lines.join("\n");
  },
});
