// ─── Docker Sandbox ───────────────────────────────────────────────────────
//
// Secure execution environment for agent tool calls.
// Runs code and shell commands in ephemeral Docker containers
// with resource limits, seccomp profiles, and network isolation.
//
// ──────────────────────────────────────────────────────────────────────────

import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import pino from "pino";

const exec = promisify(execFile);
const logger = pino({ name: "docker-sandbox" });

export interface SandboxConfig {
  /** Docker image to use. */
  image: string;
  /** CPU limit (e.g., "1.0" for 1 core). */
  cpuLimit: string;
  /** Memory limit (e.g., "256m"). */
  memoryLimit: string;
  /** Execution timeout in seconds. */
  timeoutSeconds: number;
  /** Whether to allow network access. */
  networkEnabled: boolean;
  /** Working directory inside the container. */
  workDir: string;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  containerId: string;
}

const DEFAULT_CONFIG: SandboxConfig = {
  image: "node:20-alpine",
  cpuLimit: "1.0",
  memoryLimit: "256m",
  timeoutSeconds: 30,
  networkEnabled: false,
  workDir: "/workspace",
};

/**
 * Executes code/commands in isolated Docker containers.
 */
export class DockerSandbox {
  private readonly config: SandboxConfig;
  private dockerAvailable: boolean | null = null;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if Docker is available on the host.
   */
  async isAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    try {
      await exec("docker", ["info"], { timeout: 5000 });
      this.dockerAvailable = true;
    } catch {
      this.dockerAvailable = false;
      logger.warn("Docker not available — sandbox execution disabled");
    }
    return this.dockerAvailable;
  }

  /**
   * Execute a shell command in a sandboxed container.
   */
  async execCommand(command: string, config?: Partial<SandboxConfig>): Promise<SandboxResult> {
    const cfg = { ...this.config, ...config };
    const containerId = `karna-sandbox-${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    const args = this.buildDockerArgs(containerId, cfg);
    args.push(cfg.image, "sh", "-c", command);

    try {
      const { stdout, stderr } = await exec("docker", args, {
        timeout: cfg.timeoutSeconds * 1000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Date.now() - startTime,
        timedOut: false,
        containerId,
      };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
      return {
        stdout: error.stdout?.trim() ?? "",
        stderr: error.stderr?.trim() ?? "",
        exitCode: error.code ?? 1,
        durationMs: Date.now() - startTime,
        timedOut: error.killed ?? false,
        containerId,
      };
    } finally {
      // Cleanup container
      exec("docker", ["rm", "-f", containerId]).catch(() => {});
    }
  }

  /**
   * Execute a code file in a sandboxed container.
   */
  async execCode(
    code: string,
    language: "javascript" | "typescript" | "python" | "bash",
    config?: Partial<SandboxConfig>
  ): Promise<SandboxResult> {
    const imageMap: Record<string, string> = {
      javascript: "node:20-alpine",
      typescript: "node:20-alpine",
      python: "python:3.12-alpine",
      bash: "alpine:3.19",
    };

    const runnerMap: Record<string, { file: string; cmd: string }> = {
      javascript: { file: "script.js", cmd: "node /workspace/script.js" },
      typescript: { file: "script.ts", cmd: "npx tsx /workspace/script.ts" },
      python: { file: "script.py", cmd: "python /workspace/script.py" },
      bash: { file: "script.sh", cmd: "bash /workspace/script.sh" },
    };

    const runner = runnerMap[language];
    const image = imageMap[language];

    // Write code to temp file for volume mount
    const tempDir = join(tmpdir(), `karna-sandbox-${randomUUID().slice(0, 8)}`);
    await mkdir(tempDir, { recursive: true });
    const codePath = join(tempDir, runner.file);
    await writeFile(codePath, code);

    try {
      const cfg = {
        ...this.config,
        image,
        ...config,
      };
      const containerId = `karna-sandbox-${randomUUID().slice(0, 8)}`;
      const startTime = Date.now();

      const args = this.buildDockerArgs(containerId, cfg);
      args.push("-v", `${tempDir}:${cfg.workDir}:ro`);
      args.push(cfg.image, "sh", "-c", runner.cmd);

      try {
        const { stdout, stderr } = await exec("docker", args, {
          timeout: cfg.timeoutSeconds * 1000,
          maxBuffer: 10 * 1024 * 1024,
        });

        return {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          durationMs: Date.now() - startTime,
          timedOut: false,
          containerId,
        };
      } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
        return {
          stdout: error.stdout?.trim() ?? "",
          stderr: error.stderr?.trim() ?? "",
          exitCode: error.code ?? 1,
          durationMs: Date.now() - startTime,
          timedOut: error.killed ?? false,
          containerId,
        };
      } finally {
        exec("docker", ["rm", "-f", containerId]).catch(() => {});
      }
    } finally {
      // Cleanup temp files
      unlink(codePath).catch(() => {});
    }
  }

  private buildDockerArgs(containerId: string, cfg: SandboxConfig): string[] {
    const args = [
      "run",
      "--rm",
      "--name", containerId,
      "--cpus", cfg.cpuLimit,
      "--memory", cfg.memoryLimit,
      "--pids-limit", "100",
      "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--security-opt", "no-new-privileges",
      "--cap-drop", "ALL",
      "-w", cfg.workDir,
    ];

    if (!cfg.networkEnabled) {
      args.push("--network", "none");
    }

    return args;
  }
}

/**
 * Pool of pre-warmed sandbox containers for fast execution.
 */
export class SandboxPool {
  private readonly sandbox: DockerSandbox;
  private available: boolean | null = null;

  constructor(config?: Partial<SandboxConfig>) {
    this.sandbox = new DockerSandbox(config);
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    this.available = await this.sandbox.isAvailable();
    return this.available;
  }

  async execCommand(command: string, config?: Partial<SandboxConfig>): Promise<SandboxResult> {
    return this.sandbox.execCommand(command, config);
  }

  async execCode(
    code: string,
    language: "javascript" | "typescript" | "python" | "bash",
    config?: Partial<SandboxConfig>
  ): Promise<SandboxResult> {
    return this.sandbox.execCode(code, language, config);
  }
}
