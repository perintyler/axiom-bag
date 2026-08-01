import { describe, it, expect } from "vitest";
import {
  buildSearchAPL,
  buildContextAPL,
  buildAggregateAPL,
  buildServicesAPL,
  buildNetworkSearchAPL,
  buildNetworkStatsAPL,
} from "./apl-builder.js";

describe("buildSearchAPL", () => {
  it("returns defaults with no filters", () => {
    const apl = buildSearchAPL({});
    expect(apl).toBe("['barry'] | sort by _time desc | take 50");
  });

  it("applies query filter", () => {
    const apl = buildSearchAPL({ query: "timeout" });
    expect(apl).toBe(
      "['barry'] | where msg contains 'timeout' | sort by _time desc | take 50",
    );
  });

  it("applies level filter", () => {
    const apl = buildSearchAPL({ level: "error" });
    expect(apl).toBe(
      "['barry'] | where level == 'error' | sort by _time desc | take 50",
    );
  });

  it("applies service filter", () => {
    const apl = buildSearchAPL({ service: "api" });
    expect(apl).toBe(
      "['barry'] | where service == 'api' | sort by _time desc | take 50",
    );
  });

  it("applies all filters in order: level, service, query", () => {
    const apl = buildSearchAPL({ level: "warn", service: "mcp", query: "slow" });
    expect(apl).toBe(
      "['barry'] | where level == 'warn' | where service == 'mcp' | where msg contains 'slow' | sort by _time desc | take 50",
    );
  });

  it("respects custom dataset", () => {
    const apl = buildSearchAPL({}, { dataset: "custom_ds" });
    expect(apl).toContain("['custom_ds']");
  });

  it("respects custom limit", () => {
    const apl = buildSearchAPL({}, { limit: 10 });
    expect(apl).toContain("take 10");
  });

  it("respects ascending sort", () => {
    const apl = buildSearchAPL({}, { sort: "asc" });
    expect(apl).toContain("sort by _time asc");
  });

  it("escapes single quotes in filter values", () => {
    const apl = buildSearchAPL({ query: "it's broken" });
    expect(apl).toContain("it\\'s broken");
  });

  it("escapes backslashes in filter values", () => {
    const apl = buildSearchAPL({ service: "path\\to\\svc" });
    expect(apl).toContain("path\\\\to\\\\svc");
  });
});

describe("buildContextAPL", () => {
  it("returns defaults without service", () => {
    const apl = buildContextAPL("2024-01-01T00:00:00Z");
    expect(apl).toBe("['barry'] | sort by _time asc | take 50");
  });

  it("filters by service", () => {
    const apl = buildContextAPL("2024-01-01T00:00:00Z", { service: "api" });
    expect(apl).toBe(
      "['barry'] | where service == 'api' | sort by _time asc | take 50",
    );
  });

  it("respects custom limit", () => {
    const apl = buildContextAPL("2024-01-01T00:00:00Z", { limit: 5 });
    expect(apl).toContain("take 5");
  });

  it("escapes service names with quotes", () => {
    const apl = buildContextAPL("2024-01-01T00:00:00Z", { service: "it's" });
    expect(apl).toContain("it\\'s");
  });
});

describe("buildAggregateAPL", () => {
  it("builds count metric", () => {
    const apl = buildAggregateAPL({ metric: "count" }, "1h");
    expect(apl).toBe(
      "['barry'] | summarize count() by bin(_time, 5m)",
    );
  });

  it("builds error_count metric", () => {
    const apl = buildAggregateAPL({ metric: "error_count" }, "1h");
    expect(apl).toContain("where level == 'error'");
    expect(apl).toContain("summarize count() by bin(_time, 5m)");
  });

  it("builds error_rate metric", () => {
    const apl = buildAggregateAPL({ metric: "error_rate" }, "1h");
    expect(apl).toContain("summarize errors = countif(level == 'error'), total = count()");
    expect(apl).toContain("extend rate = iif(total == 0, 0.0, toreal(errors) / toreal(total))");
  });

  it("builds volume_over_time metric", () => {
    const apl = buildAggregateAPL({ metric: "volume_over_time" }, "1h");
    expect(apl).toContain("summarize count() by bin(_time, 5m)");
  });

  it("builds top_services metric (no bin)", () => {
    const apl = buildAggregateAPL({ metric: "top_services" }, "1h");
    expect(apl).toContain("summarize count = count() by service");
    expect(apl).toContain("sort by count desc");
    expect(apl).toContain("take 20");
    expect(apl).not.toContain("bin(_time");
  });

  it("builds top_messages metric", () => {
    const apl = buildAggregateAPL({ metric: "top_messages" }, "1h");
    expect(apl).toContain("where level == 'error'");
    expect(apl).toContain("summarize count = count() by msg");
    expect(apl).toContain("take 20");
  });

  it("prepends service filter when provided", () => {
    const apl = buildAggregateAPL({ metric: "count", service: "api" }, "1h");
    // service filter should come before the summarize
    const serviceIdx = apl.indexOf("where service == 'api'");
    const summarizeIdx = apl.indexOf("summarize");
    expect(serviceIdx).toBeGreaterThan(-1);
    expect(serviceIdx).toBeLessThan(summarizeIdx);
  });

  it("uses custom binSize over inferred", () => {
    const apl = buildAggregateAPL({ metric: "count", binSize: "30m" }, "1h");
    expect(apl).toContain("bin(_time, 30m)");
  });

  describe("bin size inference", () => {
    it("infers 1m for 15m timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "15m");
      expect(apl).toContain("bin(_time, 1m)");
    });

    it("infers 5m for 2h timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "2h");
      expect(apl).toContain("bin(_time, 5m)");
    });

    it("infers 15m for 6h timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "6h");
      expect(apl).toContain("bin(_time, 15m)");
    });

    it("infers 1h for 1d timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "1d");
      expect(apl).toContain("bin(_time, 1h)");
    });

    it("infers 6h for 1w timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "1w");
      expect(apl).toContain("bin(_time, 6h)");
    });

    it("infers 1d for 1M timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "1M");
      expect(apl).toContain("bin(_time, 1d)");
    });

    it("defaults to 5m for unparseable timeframe", () => {
      const apl = buildAggregateAPL({ metric: "count" }, "garbage");
      expect(apl).toContain("bin(_time, 5m)");
    });
  });
});

describe("buildServicesAPL", () => {
  it("returns a fixed query against the barry dataset", () => {
    const apl = buildServicesAPL();
    expect(apl).toBe(
      "['barry'] | summarize count = count(), last_seen = max(_time) by service | sort by count desc",
    );
  });
});

describe("buildNetworkSearchAPL", () => {
  it("returns defaults with no filters", () => {
    const apl = buildNetworkSearchAPL({});
    expect(apl).toBe("['barry_network'] | sort by _time desc | take 50");
  });

  it("filters by eventType", () => {
    const apl = buildNetworkSearchAPL({ eventType: "dns" });
    expect(apl).toContain("where network_event_type == 'dns'");
  });

  it("filters by hostname", () => {
    const apl = buildNetworkSearchAPL({ hostname: "example.com" });
    expect(apl).toContain("where hostname == 'example.com'");
  });

  it("filters by query", () => {
    const apl = buildNetworkSearchAPL({ query: "error" });
    expect(apl).toContain("where message contains 'error'");
  });

  it("applies all filters in order: eventType, hostname, query", () => {
    const apl = buildNetworkSearchAPL({
      eventType: "http",
      hostname: "api.test",
      query: "500",
    });
    const etIdx = apl.indexOf("network_event_type");
    const hostIdx = apl.indexOf("hostname");
    const queryIdx = apl.indexOf("message contains");
    expect(etIdx).toBeLessThan(hostIdx);
    expect(hostIdx).toBeLessThan(queryIdx);
  });

  it("respects custom limit", () => {
    const apl = buildNetworkSearchAPL({}, { limit: 5 });
    expect(apl).toContain("take 5");
  });
});

describe("buildNetworkStatsAPL", () => {
  it("builds count metric", () => {
    const apl = buildNetworkStatsAPL("count", "1h");
    expect(apl).toContain("['barry_network']");
    expect(apl).toContain("summarize count() by bin(_time, 5m)");
  });

  it("builds volume_over_time metric", () => {
    const apl = buildNetworkStatsAPL("volume_over_time", "1h");
    expect(apl).toContain("summarize count() by bin(_time, 5m)");
  });

  it("builds top_hostnames metric", () => {
    const apl = buildNetworkStatsAPL("top_hostnames", "1h");
    expect(apl).toContain("summarize count = count() by hostname");
    expect(apl).toContain("sort by count desc");
    expect(apl).toContain("take 20");
  });

  it("builds event_types metric", () => {
    const apl = buildNetworkStatsAPL("event_types", "1h");
    expect(apl).toContain("summarize count = count() by network_event_type");
    expect(apl).toContain("sort by count desc");
    expect(apl).not.toContain("take");
  });

  it("uses inferred bin size from timeframe", () => {
    const apl = buildNetworkStatsAPL("count", "1d");
    expect(apl).toContain("bin(_time, 1h)");
  });
});
