#!/usr/bin/env node

const { mkdir, readdir, readFile, writeFile } = require("node:fs/promises");
const { dirname, join, relative } = require("node:path");

const root = process.cwd();
const ignoredDirs = new Set([".git", ".next", "dist", "node_modules"]);
const dependencyFields = ["dependencies", "peerDependencies", "optionalDependencies"];
const graphPath =
  process.argv.slice(2).find((arg) => arg !== "--") ??
  "artifacts/workspace-graph.dot";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const manifests = await loadWorkspaceManifests();
  const packageNames = new Set(manifests.map((manifest) => manifest.name));
  const graph = new Map();
  const violations = [];

  for (const manifest of manifests) {
    const internalDeps = getInternalDependencies(manifest, packageNames);
    graph.set(manifest.name, internalDeps);

    if (manifest.name === "@karna/shared" && internalDeps.length > 0) {
      violations.push(
        `@karna/shared must not depend on internal packages: ${internalDeps.join(", ")}`,
      );
    }

    if (manifest.relativeDir.startsWith("channels/")) {
      const channelDeps = internalDeps.filter((dep) => {
        const depManifest = manifests.find((candidate) => candidate.name === dep);
        return depManifest?.relativeDir.startsWith("channels/");
      });
      if (channelDeps.length > 0) {
        violations.push(
          `${manifest.relativeDir} must not depend on other channels: ${channelDeps.join(", ")}`,
        );
      }
    }
  }

  const cycles = findCycles(graph);
  for (const cycle of cycles) {
    violations.push(`Circular dependency detected: ${cycle.join(" -> ")}`);
  }

  await writeGraph(graphPath, graph);

  if (violations.length > 0) {
    console.error("Workspace dependency graph validation failed.");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `Validated ${manifests.length} workspace packages; graph written to ${graphPath}.`,
  );
}

async function loadWorkspaceManifests() {
  const files = await findPackageJsonFiles(root);
  const manifests = [];

  for (const filePath of files) {
    const manifest = JSON.parse(await readFile(filePath, "utf-8"));
    if (!manifest.name || filePath === join(root, "package.json")) continue;
    manifests.push({
      ...manifest,
      filePath,
      relativeDir: dirname(relative(root, filePath)),
    });
  }

  return manifests;
}

function getInternalDependencies(manifest, packageNames) {
  const deps = new Set();
  for (const field of dependencyFields) {
    const entries = manifest[field];
    if (!entries || typeof entries !== "object") continue;
    for (const name of Object.keys(entries)) {
      if (packageNames.has(name)) deps.add(name);
    }
  }
  return Array.from(deps).sort();
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    if (visited.has(node)) return;

    visiting.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
}

async function writeGraph(filePath, graph) {
  await mkdir(dirname(filePath), { recursive: true });
  const lines = ["digraph workspace {", "  rankdir=LR;"];

  for (const node of graph.keys()) {
    lines.push(`  "${node}";`);
  }
  for (const [node, deps] of graph) {
    for (const dep of deps) {
      lines.push(`  "${node}" -> "${dep}";`);
    }
  }

  lines.push("}");
  await writeFile(filePath, `${lines.join("\n")}\n`);
}

async function findPackageJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      files.push(...(await findPackageJsonFiles(join(dir, entry.name))));
    } else if (entry.name === "package.json") {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}
