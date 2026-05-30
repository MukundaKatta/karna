import { describe, it, expect, beforeEach } from "vitest";
import {
  SandboxSelector,
  InProcessRuntime,
  FakeRuntime,
  createSelector,
  marshal,
  unmarshal,
  type SandboxExecutionSpec,
} from "../../agent/src/sandbox/isolation.js";
import {
  enforceWallClock,
  resolveLimits,
  limitsToDocker,
  ResourceLimitBreachError,
  isResourceLimitBreach,
  InMemoryBreachCounter,
  DEFAULT_RESOURCE_LIMITS,
} from "../../agent/src/sandbox/limits.js";

// ─── Marshalling ──────────────────────────────────────────────────────────

describe("marshal / unmarshal", () => {
  it("round-trips objects across the boundary", () => {
    const value = { a: 1, b: ["x", "y"], c: { nested: true } };
    const round = unmarshal(marshal(value));
    expect(round).toEqual(value);
  });

  it("handles null / undefined", () => {
    expect(unmarshal(marshal(undefined))).toBeNull();
    expect(unmarshal(marshal(null))).toBeNull();
  });

  it("throws on malformed payload", () => {
    expect(() => unmarshal("not json")).toThrow(/Failed to unmarshal/);
  });

  it("throws on unsupported envelope", () => {
    expect(() => unmarshal(JSON.stringify({ v: 99, data: 1 }))).toThrow(/Unsupported/);
  });
});

// ─── Routing by risk level ────────────────────────────────────────────────

describe("SandboxSelector routing", () => {
  let isolated: FakeRuntime;
  let inProcess: FakeRuntime;
  let selector: SandboxSelector;

  beforeEach(() => {
    isolated = new FakeRuntime(undefined, "docker");
    inProcess = new FakeRuntime(undefined, "in-process");
    selector = new SandboxSelector({
      isolatedRuntime: isolated,
      inProcessRuntime: inProcess,
    });
  });

  it("routes high-risk tools to the isolated runtime", async () => {
    const res = await selector.execute("danger", "high", { x: 1 });
    expect(res.runtime).toBe("docker");
    expect(isolated.calls).toHaveLength(1);
    expect(inProcess.calls).toHaveLength(0);
  });

  it("routes critical-risk tools to the isolated runtime", async () => {
    await selector.execute("danger", "critical", {});
    expect(isolated.calls).toHaveLength(1);
  });

  it("routes low-risk tools in-process", async () => {
    const res = await selector.execute("safe", "low", { x: 1 });
    expect(res.runtime).toBe("in-process");
    expect(inProcess.calls).toHaveLength(1);
    expect(isolated.calls).toHaveLength(0);
  });

  it("routes medium-risk tools in-process by default", async () => {
    await selector.execute("safe", "medium", {});
    expect(inProcess.calls).toHaveLength(1);
    expect(isolated.calls).toHaveLength(0);
  });

  it("honors custom isolate risk levels", async () => {
    const sel = new SandboxSelector({
      isolatedRuntime: isolated,
      inProcessRuntime: inProcess,
      isolateRiskLevels: ["medium", "high", "critical"],
    });
    await sel.execute("t", "medium", {});
    expect(isolated.calls).toHaveLength(1);
  });

  it("requiresIsolation / selectRuntime reflect routing", () => {
    expect(selector.requiresIsolation("high")).toBe(true);
    expect(selector.requiresIsolation("low")).toBe(false);
    expect(selector.selectRuntime("critical")).toBe(isolated);
    expect(selector.selectRuntime("low")).toBe(inProcess);
  });

  it("marshals input across the boundary and returns unmarshalled output", async () => {
    const echo = new FakeRuntime(undefined, "docker");
    const sel = new SandboxSelector({
      isolatedRuntime: echo,
      inProcessRuntime: inProcess,
    });
    const res = await sel.execute<{ payload: number }>("t", "high", { payload: 42 });
    expect(res.output).toEqual({ payload: 42 });
    // The spec the runtime received carried a serialized payload string.
    const spec: SandboxExecutionSpec = echo.calls[0];
    expect(typeof spec.payload).toBe("string");
    expect(unmarshal(spec.payload)).toEqual({ payload: 42 });
  });

  it("falls back to in-process when the isolated runtime is unavailable", async () => {
    isolated.available = false;
    const res = await selector.execute("danger", "high", {});
    expect(res.runtime).toBe("in-process");
    expect(inProcess.calls).toHaveLength(1);
    expect(isolated.calls).toHaveLength(0);
  });

  it("passes resource limits into the execution spec", async () => {
    await selector.execute("t", "high", {}, { limits: { memoryMb: 512 } });
    expect(isolated.calls[0].limits.memoryMb).toBe(512);
    expect(isolated.calls[0].limits.cpuCores).toBe(DEFAULT_RESOURCE_LIMITS.cpuCores);
  });
});

describe("InProcessRuntime", () => {
  it("invokes the handler and marshals the result", async () => {
    const rt = new InProcessRuntime((input) => ({ doubled: (input as { n: number }).n * 2 }));
    const out = await rt.run(
      { toolName: "t", riskLevel: "low", payload: marshal({ n: 5 }), limits: DEFAULT_RESOURCE_LIMITS },
      new AbortController().signal
    );
    expect(unmarshal(out)).toEqual({ doubled: 10 });
  });

  it("is always available", async () => {
    expect(await new InProcessRuntime(() => null).isAvailable()).toBe(true);
  });
});

describe("createSelector factory", () => {
  it("wires an in-process handler for low-risk tools", async () => {
    const isolated = new FakeRuntime(undefined, "firecracker");
    const sel = createSelector(isolated, (input) => ({ seen: input }));
    const res = await sel.execute("t", "low", { hello: "world" });
    expect(res.runtime).toBe("in-process");
    expect(res.output).toEqual({ seen: { hello: "world" } });
  });
});

// ─── Resource limits ──────────────────────────────────────────────────────

describe("resolveLimits / limitsToDocker", () => {
  it("merges overrides onto defaults", () => {
    const limits = resolveLimits({ memoryMb: 128 });
    expect(limits.memoryMb).toBe(128);
    expect(limits.cpuCores).toBe(DEFAULT_RESOURCE_LIMITS.cpuCores);
  });

  it("formats docker cpu/memory strings", () => {
    expect(limitsToDocker({ cpuCores: 2, memoryMb: 512, wallClockMs: 1000 })).toEqual({
      cpus: "2",
      memory: "512m",
    });
  });
});

describe("enforceWallClock", () => {
  it("resolves work that finishes within the limit", async () => {
    const result = await enforceWallClock(async () => "ok", {
      wallClockMs: 1000,
      counter: new InMemoryBreachCounter(),
    });
    expect(result).toBe("ok");
  });

  it("throws a structured breach error and increments the counter on timeout", async () => {
    const counter = new InMemoryBreachCounter();
    const work = (signal: AbortSignal) =>
      new Promise<string>((resolve) => {
        // Never settles on its own; only the abort cleans the timer up.
        signal.addEventListener("abort", () => resolve("late"));
      });

    await expect(
      enforceWallClock(work, { wallClockMs: 10, counter })
    ).rejects.toBeInstanceOf(ResourceLimitBreachError);

    expect(counter.count).toBe(1);
    expect(counter.countFor("wall-clock")).toBe(1);
  });

  it("aborts the work signal on breach", async () => {
    let aborted = false;
    const work = (signal: AbortSignal) =>
      new Promise<string>(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    await expect(enforceWallClock(work, { wallClockMs: 10 })).rejects.toBeInstanceOf(
      ResourceLimitBreachError
    );
    expect(aborted).toBe(true);
  });

  it("propagates work errors unchanged", async () => {
    await expect(
      enforceWallClock(async () => {
        throw new Error("boom");
      }, { wallClockMs: 1000 })
    ).rejects.toThrow("boom");
  });

  it("breach error carries kind and limit value", () => {
    const err = new ResourceLimitBreachError("wall-clock", 30);
    expect(err.kind).toBe("wall-clock");
    expect(err.limitValue).toBe(30);
    expect(isResourceLimitBreach(err)).toBe(true);
    expect(isResourceLimitBreach(new Error("x"))).toBe(false);
  });
});

// ─── Integration: selector + wall-clock breach ─────────────────────────────

describe("SandboxSelector wall-clock enforcement", () => {
  it("surfaces a breach when an isolated runtime hangs", async () => {
    const counter = new InMemoryBreachCounter();
    const hanging = new FakeRuntime(
      (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(null));
        }),
      "docker"
    );
    const selector = new SandboxSelector({
      isolatedRuntime: hanging,
      inProcessRuntime: new InProcessRuntime(() => null),
      breachCounter: counter,
    });

    await expect(
      selector.execute("slow", "high", {}, { limits: { wallClockMs: 10 } })
    ).rejects.toBeInstanceOf(ResourceLimitBreachError);
    expect(counter.countFor("wall-clock")).toBe(1);
  });
});
