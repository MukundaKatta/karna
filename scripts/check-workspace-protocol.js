#!/usr/bin/env node

const { readdir, readFile } = require("node:fs/promises");
const { join, relative } = require("node:path");

const root = process.cwd();
const ignoredDirs = new Set([".git", ".next", "dist", "node_modules"]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const packageJsonFiles = await findPackageJsonFiles(root);
  const violations = [];

  for (const filePath of packageJsonFiles) {
    const manifest = JSON.parse(await readFile(filePath, "utf-8"));
    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!dependencies || typeof dependencies !== "object") continue;

      for (const [name, specifier] of Object.entries(dependencies)) {
        if (!name.startsWith("@karna/")) continue;
        if (specifier !== "workspace:*") {
          violations.push({
            filePath,
            field,
            name,
            specifier,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("Internal @karna/* dependencies must use workspace:*.");
    for (const violation of violations) {
      console.error(
        `- ${relative(root, violation.filePath)} ${violation.field}.${violation.name} = ${violation.specifier}`,
      );
    }
    process.exit(1);
  }

  console.log(`Verified ${packageJsonFiles.length} package manifests use workspace:* for internal dependencies.`);
}

async function findPackageJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      const nestedFiles = await findPackageJsonFiles(join(dir, entry.name));
      files.push(...nestedFiles);
      continue;
    }

    if (entry.name === "package.json") {
      files.push(join(dir, entry.name));
    }
  }

  return files;
}
