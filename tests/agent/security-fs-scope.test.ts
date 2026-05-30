import { describe, it, expect } from "vitest";
import {
  resolveScoped,
  resolveScopedOrThrow,
  isPathInScope,
  PathScopeError,
} from "../../agent/src/tools/security/fs-scope.js";

const ROOT = "/srv/workspace";
const opts = { flavor: "posix" as const };

describe("fs-scope (#558)", () => {
  it("resolves a simple relative path inside the root", () => {
    const r = resolveScoped(ROOT, "notes/todo.txt", opts);
    expect(r).toEqual({ ok: true, path: "/srv/workspace/notes/todo.txt" });
  });

  it("normalizes redundant separators and dot segments", () => {
    const r = resolveScoped(ROOT, "./a//b/../c.txt", opts);
    expect(r.ok && r.path).toBe("/srv/workspace/a/c.txt");
  });

  it("allows the root itself by default", () => {
    expect(isPathInScope(ROOT, ".", opts)).toBe(true);
  });

  it("can forbid the root itself when allowRoot=false", () => {
    expect(isPathInScope(ROOT, ".", { ...opts, allowRoot: false })).toBe(false);
    expect(isPathInScope(ROOT, "sub", { ...opts, allowRoot: false })).toBe(true);
  });

  describe("traversal attacks", () => {
    const attacks = [
      "../etc/passwd",
      "../../etc/passwd",
      "a/../../etc/passwd",
      "foo/../../../../../../etc/shadow",
      "..",
      "./../outside",
    ];
    for (const attack of attacks) {
      it(`rejects traversal: ${attack}`, () => {
        const r = resolveScoped(ROOT, attack, opts);
        expect(r.ok).toBe(false);
      });
    }

    it("rejects an absolute path that would escape (treated as relative, then bounded)", () => {
      // Absolute input is stripped to relative; this stays inside the root.
      const r = resolveScoped(ROOT, "/etc/passwd", opts);
      expect(r.ok && r.path).toBe("/srv/workspace/etc/passwd");
    });

    it("does not allow a sibling prefix to masquerade as inside", () => {
      // /srv/workspace-evil should NOT count as inside /srv/workspace
      const r = resolveScoped("/srv/workspace", "../workspace-evil/x", opts);
      expect(r.ok).toBe(false);
    });

    it("rejects NUL byte poisoning", () => {
      const r = resolveScoped(ROOT, "ok\0/../../etc/passwd", opts);
      expect(r).toEqual({ ok: false, reason: "path contains NUL byte" });
    });

    it("rejects an empty root", () => {
      expect(resolveScoped("", "x", opts).ok).toBe(false);
    });
  });

  describe("win32 flavor", () => {
    it("strips drive prefixes and confines", () => {
      const r = resolveScoped("C:/scope", "C:/Windows/system32", { flavor: "win32" });
      expect(r.ok).toBe(true);
      // path is bounded under the scope
      expect(r.ok && r.path.toLowerCase().startsWith("c:\\scope")).toBe(true);
    });

    it("rejects backslash traversal", () => {
      const r = resolveScoped("C:/scope", "..\\..\\Windows", { flavor: "win32" });
      expect(r.ok).toBe(false);
    });
  });

  describe("resolveScopedOrThrow", () => {
    it("returns the path on success", () => {
      expect(resolveScopedOrThrow(ROOT, "x.txt", opts)).toBe("/srv/workspace/x.txt");
    });
    it("throws PathScopeError on escape", () => {
      expect(() => resolveScopedOrThrow(ROOT, "../../x", opts)).toThrow(PathScopeError);
    });
  });
});
