import { describe, it, expect } from "vitest";
import {
  isValidSemver,
  parseSemver,
  compareSemver,
  isSunset,
  withVersion,
  checkDeprecation,
  checkDeprecations,
  type VersionedLike,
} from "../../packages/plugin-sdk/src/versioning.js";

function entity(name: string, deprecated?: unknown): VersionedLike {
  return { metadata: { name, deprecated: deprecated as never } };
}

describe("plugin-sdk versioning", () => {
  it("validates and parses semver", () => {
    expect(isValidSemver("1.2.3")).toBe(true);
    expect(isValidSemver("1.2")).toBe(false);
    expect(isValidSemver("v1.2.3")).toBe(false);
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("nope")).toBeNull();
  });

  it("compares semver and returns null on invalid input", () => {
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.1", "2.0.0")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("bad", "1.0.0")).toBeNull();
  });

  it("withVersion attaches metadata immutably and rejects bad semver", () => {
    const base = { name: "my_tool" };
    const out = withVersion(base, { version: "1.4.0" });
    expect(out).toEqual({ name: "my_tool", version: "1.4.0" });
    expect(base).toEqual({ name: "my_tool" }); // original untouched
    expect(() => withVersion(base, { version: "not-semver" })).toThrow();
  });

  it("checkDeprecation returns null when not deprecated", () => {
    expect(checkDeprecation(entity("fine"))).toBeNull();
  });

  it("checkDeprecation produces a warning with guidance", () => {
    const e = entity("old_tool", {
      since: "2.0.0",
      replacement: "new_tool",
      sunset: "3.0.0",
      reason: "migrate soon",
    });
    const warning = checkDeprecation(e);
    expect(warning).not.toBeNull();
    expect(warning!.name).toBe("old_tool");
    expect(warning!.since).toBe("2.0.0");
    expect(warning!.replacement).toBe("new_tool");
    expect(warning!.sunsetReached).toBe(false);
    expect(warning!.message).toContain("deprecated since 2.0.0");
    expect(warning!.message).toContain('Use "new_tool" instead');
    expect(warning!.message).toContain("migrate soon");
    expect(warning!.message).toContain("Scheduled for removal at 3.0.0");
  });

  it("marks sunsetReached when currentVersion reaches the sunset semver", () => {
    const e = entity("gone", { since: "2.0.0", sunset: "3.0.0" });
    expect(checkDeprecation(e, { currentVersion: "2.5.0" })!.sunsetReached).toBe(false);
    const expired = checkDeprecation(e, { currentVersion: "3.0.0" })!;
    expect(expired.sunsetReached).toBe(true);
    expect(expired.message).toContain("reached its sunset");
  });

  it("isSunset supports date-style sunsets via now", () => {
    const dep = { since: "2026-01-01", sunset: "2026-06-01" } as never;
    expect(isSunset(dep, { now: new Date("2026-05-01") })).toBe(false);
    expect(isSunset(dep, { now: new Date("2026-07-01") })).toBe(true);
  });

  it("checkDeprecations flattens warnings across many entities", () => {
    const entities = [
      entity("a"),
      entity("b", { since: "1.0.0" }),
      entity("c", { since: "1.1.0" }),
    ];
    const warnings = checkDeprecations(entities);
    expect(warnings.map((w) => w.name)).toEqual(["b", "c"]);
  });
});
