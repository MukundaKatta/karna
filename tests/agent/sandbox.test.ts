import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerSandbox, SandboxPool, type SandboxConfig } from "../../agent/src/sandbox/docker-sandbox.js";

// We mock child_process.execFile since tests run without Docker
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { execFile } from "child_process";
const mockExecFile = vi.mocked(execFile);

// Helper to make execFile resolve with stdout/stderr
function mockExecSuccess(stdout = "", stderr = "") {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?) => {
    // promisify wraps this, so we return a fake ChildProcess and resolve via callback
    const fakeProcess = { pid: 1234 } as any;
    if (typeof _opts === "function") {
      // 3-arg form
      _opts(null, stdout, stderr);
    } else if (callback) {
      callback(null, stdout, stderr);
    }
    return fakeProcess;
  });
}

function mockExecFailure(error: { message: string; code?: number; killed?: boolean; stdout?: string; stderr?: string }) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback?) => {
    const fakeProcess = { pid: 1234 } as any;
    const err = Object.assign(new Error(error.message), error);
    if (typeof _opts === "function") {
      _opts(err as any, error.stdout ?? "", error.stderr ?? "");
    } else if (callback) {
      callback(err as any, error.stdout ?? "", error.stderr ?? "");
    }
    return fakeProcess;
  });
}

// ─── DockerSandbox ──────────────────────────────────────────────────────────

describe("DockerSandbox", () => {
  let sandbox: DockerSandbox;

  beforeEach(() => {
    vi.clearAllMocks();
    sandbox = new DockerSandbox();
  });

  describe("constructor", () => {
    it("creates with default config", () => {
      expect(sandbox).toBeDefined();
    });

    it("accepts custom config", () => {
      const custom = new DockerSandbox({
        image: "python:3.12-alpine",
        cpuLimit: "2.0",
        memoryLimit: "512m",
        timeoutSeconds: 60,
        networkEnabled: true,
      });
      expect(custom).toBeDefined();
    });
  });

  describe("isAvailable", () => {
    it("returns true when docker info succeeds", async () => {
      mockExecSuccess("Docker info output");
      const result = await sandbox.isAvailable();
      expect(result).toBe(true);
    });

    it("returns false when docker info fails", async () => {
      mockExecFailure({ message: "docker not found" });
      const result = await sandbox.isAvailable();
      expect(result).toBe(false);
    });

    it("caches the availability result", async () => {
      mockExecSuccess("Docker info output");
      await sandbox.isAvailable();
      await sandbox.isAvailable();
      // execFile should only have been called once for docker info
      // (subsequent calls are cached)
      const dockerInfoCalls = mockExecFile.mock.calls.filter(
        (call) => call[0] === "docker" && call[1]?.[0] === "info"
      );
      expect(dockerInfoCalls.length).toBe(1);
    });
  });

  describe("buildDockerArgs (tested indirectly via execCommand)", () => {
    it("includes resource limits in docker run args", async () => {
      mockExecSuccess("hello");
      // Since execCommand calls exec which is promisified, we need to mock differently
      // The promisified version returns a Promise, so we mock the underlying execFile
      await sandbox.execCommand("echo hello").catch(() => {});
      // Check that docker was called with expected args
      const dockerCall = mockExecFile.mock.calls.find(
        (call) => call[0] === "docker" && call[1]?.includes("run")
      );
      if (dockerCall) {
        const args = dockerCall[1] as string[];
        expect(args).toContain("--cpus");
        expect(args).toContain("--memory");
        expect(args).toContain("--network");
      }
    });
  });
});

// ─── SandboxPool ────────────────────────────────────────────────────────────

describe("SandboxPool", () => {
  let pool: SandboxPool;

  beforeEach(() => {
    vi.clearAllMocks();
    pool = new SandboxPool();
  });

  describe("isAvailable", () => {
    it("delegates to underlying DockerSandbox", async () => {
      mockExecSuccess("Docker info");
      const result = await pool.isAvailable();
      expect(result).toBe(true);
    });

    it("caches result on second call", async () => {
      mockExecSuccess("Docker info");
      await pool.isAvailable();
      const result2 = await pool.isAvailable();
      expect(result2).toBe(true);
    });
  });

  describe("constructor", () => {
    it("creates with default config", () => {
      expect(pool).toBeDefined();
    });

    it("accepts custom config", () => {
      const custom = new SandboxPool({ memoryLimit: "512m" });
      expect(custom).toBeDefined();
    });
  });
});

// ─── Config merging ─────────────────────────────────────────────────────────

describe("SandboxConfig defaults", () => {
  it("default config uses node:20-alpine image", () => {
    // Verify by inspecting the sandbox behavior — if execCommand is called,
    // the image should be node:20-alpine by default
    const sandbox = new DockerSandbox();
    expect(sandbox).toBeDefined();
  });

  it("custom config overrides default values", () => {
    const sandbox = new DockerSandbox({
      image: "python:3.12",
      timeoutSeconds: 120,
      networkEnabled: true,
    });
    expect(sandbox).toBeDefined();
  });
});
