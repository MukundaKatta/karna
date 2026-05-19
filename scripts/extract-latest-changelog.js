#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");

const [, , changelogPath = "CHANGELOG.md", outputPath = "RELEASE_NOTES.md"] =
  process.argv;

const changelog = readFileSync(changelogPath, "utf8");
const sections = changelog.split(/\n(?=##\s)/);
const latest = sections.find((section) => /^\s*##\s/.test(section));

if (!latest) {
  throw new Error(`No release section found in ${changelogPath}`);
}

writeFileSync(outputPath, latest.trimStart());
