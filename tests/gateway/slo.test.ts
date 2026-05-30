import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATEWAY_SLOS,
  evaluateSlo,
  evaluateSlos,
  renderPrometheusAlertRules,
  type SloDefinition,
} from "../../gateway/src/slo/index.js";

const availability: SloDefinition = {
  name: "gateway_availability",
  description: "availability",
  kind: "availability",
  objective: 0.99, // 1% error budget
  windowSeconds: 3600,
};

const errorRate: SloDefinition = {
  name: "gateway_error_rate",
  description: "error rate",
  kind: "error_rate",
  objective: 0.01,
  windowSeconds: 3600,
};

const latency: SloDefinition = {
  name: "gateway_latency_p99",
  description: "p99 latency",
  kind: "latency_p99",
  objective: 1000,
  windowSeconds: 3600,
};

describe("evaluateSlo — availability", () => {
  it("is within objective and emits no alert when healthy", () => {
    const e = evaluateSlo(availability, { total: 1000, bad: 5 }); // 0.5% errors
    expect(e.withinObjective).toBe(true);
    expect(e.achieved).toBeCloseTo(0.995, 5);
    expect(e.severity).toBe("none");
    expect(e.alert).toBeUndefined();
    // budget = 1%, consumed 0.5% -> burn 0.5
    expect(e.burnRate).toBeCloseTo(0.5, 5);
  });

  it("emits a critical alert on high burn", () => {
    const e = evaluateSlo(availability, { total: 1000, bad: 200 }); // 20% errors
    expect(e.withinObjective).toBe(false);
    expect(e.severity).toBe("critical"); // burn 20 >= 10
    expect(e.alert?.severity).toBe("critical");
    expect(e.alert?.message).toContain("gateway_availability");
  });

  it("emits a warning at moderate burn", () => {
    const e = evaluateSlo(availability, { total: 1000, bad: 30 }); // 3% errors -> burn 3
    expect(e.severity).toBe("warning");
  });

  it("returns no alert when there is no traffic", () => {
    const e = evaluateSlo(availability, { total: 0 });
    expect(e.severity).toBe("none");
    expect(e.burnRate).toBeNull();
  });
});

describe("evaluateSlo — error_rate & latency", () => {
  it("flags error_rate breach", () => {
    const e = evaluateSlo(errorRate, { total: 100, bad: 50 }); // 50% vs 1%
    expect(e.achieved).toBeCloseTo(0.5, 5);
    expect(e.withinObjective).toBe(false);
    expect(e.severity).toBe("critical");
  });

  it("computes latency overage as burn", () => {
    const ok = evaluateSlo(latency, { p99Ms: 900 });
    expect(ok.withinObjective).toBe(true);
    expect(ok.severity).toBe("none");

    const breach = evaluateSlo(latency, { p99Ms: 12_000 }); // 12x over -> > 10
    expect(breach.withinObjective).toBe(false);
    expect(breach.burnRate).toBeCloseTo(11, 5);
    expect(breach.severity).toBe("critical");
  });
});

describe("evaluateSlos", () => {
  it("aggregates only alerting evaluations", () => {
    const { evaluations, alerts } = evaluateSlos([availability, latency], {
      gateway_availability: { total: 1000, bad: 0 },
      gateway_latency_p99: { p99Ms: 50_000 },
    });
    expect(evaluations).toHaveLength(2);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.slo).toBe("gateway_latency_p99");
  });
});

describe("renderPrometheusAlertRules", () => {
  it("renders valid-looking YAML with warning+critical per SLO", () => {
    const yaml = renderPrometheusAlertRules([availability, latency, errorRate]);
    expect(yaml.startsWith("groups:")).toBe(true);
    expect(yaml).toContain("name: karna_slo_alerts");
    // PascalCase alert names
    expect(yaml).toContain("alert: GatewayAvailabilityWarning");
    expect(yaml).toContain("alert: GatewayAvailabilityCritical");
    expect(yaml).toContain("alert: GatewayLatencyP99Critical");
    // severity labels and exprs present
    expect(yaml).toContain("severity: warning");
    expect(yaml).toContain("severity: critical");
    expect(yaml).toContain("slo:gateway_availability:error_ratio");
    expect(yaml).toContain("slo:gateway_latency_p99:p99_ms");
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("works with the default gateway SLO catalogue", () => {
    const yaml = renderPrometheusAlertRules(DEFAULT_GATEWAY_SLOS);
    expect(yaml).toContain("alert: GatewayErrorRateCritical");
  });
});
