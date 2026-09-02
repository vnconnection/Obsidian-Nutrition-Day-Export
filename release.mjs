import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const RELEASE_MANIFEST_ID = "nutrition-day-export";
export const RELEASE_NOTES_DIRECTORY = join("docs", "releases");
export const SEMVER_TAG_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export const RELEASE_IMPACTS = [
  "breaking",
  "feat",
  "fix",
  "perf",
  "docs",
  "test",
  "chore",
  "ci",
  "build",
  "refactor",
  "style",
  "unknown",
];

const PATCH_IMPACTS = new Set(RELEASE_IMPACTS.slice(2, -1));
const NOTE_HEADINGS = new Set([
  "Summary",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Documentation",
]);
const ASSET_NAMES = ["main.js", "manifest.json"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(command, args, rootDirectory = process.cwd()) {
  execFileSync(command, args, { cwd: rootDirectory, stdio: "inherit" });
}

function readOutput(command, args, rootDirectory = process.cwd()) {
  return execFileSync(command, args, {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
}

function assertNonEmptyFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    throw new Error(`${label} is missing or empty: ${path}`);
  }
}

function assertBareSemver(version, label) {
  if (typeof version !== "string" || !SEMVER_TAG_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact bare X.Y.Z semver: ${version}`);
  }
}

function advisoryText(advisory) {
  if (Array.isArray(advisory)) {
    return advisory.map(advisoryText).join("\n");
  }
  if (typeof advisory === "string") {
    return advisory;
  }
  if (advisory && typeof advisory === "object") {
    return [
      advisory.type,
      advisory.title,
      advisory.subject,
      advisory.message,
      advisory.body,
    ]
      .filter((value) => typeof value === "string")
      .join("\n");
  }
  return "";
}

export function classifyAdvisory(advisory) {
  const text = advisoryText(advisory).toLowerCase();
  if (/breaking(?:\s+change)?/.test(text) || /(?:^|[\s(:])\w+!/.test(text)) {
    return "breaking";
  }
  if (/(?:^|[\s(:])feat(?:\([^)]*\))?(?:\s|:|$)/.test(text)) {
    return "feat";
  }
  for (const impact of PATCH_IMPACTS) {
    if (new RegExp(`(?:^|[\\s(:])${impact}(?:\\([^)]*\\))?(?:\\s|:|$)`).test(text)) {
      return impact;
    }
  }
  if (RELEASE_IMPACTS.includes(text.trim())) {
    return text.trim();
  }
  return "unknown";
}

export const classifyImpact = classifyAdvisory;

export function impactToBump(impact) {
  if (impact === "breaking") return "major";
  if (impact === "feat") return "minor";
  if (PATCH_IMPACTS.has(impact)) return "patch";
  return null;
}

export function calculateNextVersion(currentVersion, impact) {
  assertBareSemver(currentVersion, "Current package version");
  const bump = impactToBump(impact);
  if (!bump) {
    throw new Error(`Unknown release impact: ${impact}`);
  }
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function assetNames(rootDirectory) {
  const assets = [...ASSET_NAMES];
  if (existsSync(join(rootDirectory, "styles.css"))) assets.push("styles.css");
  return assets;
}

function assertReleaseNotes(rootDirectory, version) {
  const notesPath = join(rootDirectory, RELEASE_NOTES_DIRECTORY, `${version}.md`);
  assertNonEmptyFile(notesPath, "Release notes");
  const notes = readFileSync(notesPath, "utf8");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^# Release ${escapedVersion}\\s*$`, "m").test(notes)) {
    throw new Error(`Release notes heading must be # Release ${version}: ${notesPath}`);
  }
  const dateMatch = notes.match(/^Date: (\d{4}-\d{2}-\d{2})\s*$/m);
  const date = dateMatch ? new Date(`${dateMatch[1]}T00:00:00.000Z`) : null;
  if (!dateMatch || !date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== dateMatch[1]) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const headings = [...notes.matchAll(/^## ([^\n]+)\s*$/gm)];
  for (const [, heading] of headings) {
    if (!NOTE_HEADINGS.has(heading.trim())) {
      throw new Error(`Release notes contain an unsupported section: ${heading}`);
    }
  }
  const summary = notes.match(/^## Summary\s*\n([\s\S]*?)(?=^## |$)/m)?.[1].trim();
  if (!summary || /^(update|todo|tbd|n\/a)\.?$/i.test(summary)) {
    throw new Error(`Release notes summary is missing or generic: ${notesPath}`);
  }
  const concreteChange = headings.some(([, heading], index) => {
    if (heading.trim() === "Summary") return false;
    const start = headings[index].index;
    const end = headings[index + 1]?.index ?? notes.length;
    const section = notes.slice(start, end);
    return /^\s*[-*]\s+(?!update\.?$|todo\.?$|tbd\.?$|user-visible .+\.?$)\S.{8,}$/im.test(section);
  });
  if (!concreteChange) {
    throw new Error(`Release notes must contain a concrete user-visible change: ${notesPath}`);
  }
  return { notesPath, notes };
}

export function validateRelease({ rootDirectory = process.cwd(), expectedVersion } = {}) {
  const packageJson = readJson(join(rootDirectory, "package.json"));
  const manifest = readJson(join(rootDirectory, "manifest.json"));
  const packageVersion = packageJson.version;
  assertBareSemver(packageVersion, "package.json version");
  if (packageJson.name !== RELEASE_MANIFEST_ID) {
    throw new Error(`package.json name must be ${RELEASE_MANIFEST_ID}`);
  }
  if (manifest.id !== RELEASE_MANIFEST_ID) {
    throw new Error(`manifest.json id must be ${RELEASE_MANIFEST_ID}`);
  }
  if (manifest.version !== packageVersion) {
    throw new Error(`manifest.json version (${manifest.version}) does not match package.json version (${packageVersion})`);
  }
  if (expectedVersion !== undefined) {
    assertBareSemver(expectedVersion, "Expected release version");
    if (expectedVersion !== packageVersion) {
      throw new Error(`package.json version (${packageVersion}) does not match release tag (${expectedVersion})`);
    }
  }
  const versionsPath = join(rootDirectory, "versions.json");
  if (!existsSync(versionsPath)) throw new Error("versions.json is missing");
  const versions = readJson(versionsPath);
  if (typeof manifest.minAppVersion !== "string" || versions[packageVersion] !== manifest.minAppVersion) {
    throw new Error(`versions.json entry for ${packageVersion} does not match manifest.json minAppVersion`);
  }
  const releaseAssets = assetNames(rootDirectory);
  const assetPaths = releaseAssets.map((asset) => join(rootDirectory, asset));
  assetPaths.forEach((assetPath) => assertNonEmptyFile(assetPath, "Release asset"));
  return {
    version: packageVersion,
    manifestId: manifest.id,
    assetNames: releaseAssets,
    assetPaths,
    ...assertReleaseNotes(rootDirectory, expectedVersion ?? packageVersion),
  };
}

function assertArchiveLayout(rootDirectory, archivePath, expectedEntries) {
  assertNonEmptyFile(archivePath, "Release package");
  const output = readOutput("unzip", ["-Z1", archivePath], rootDirectory);
  const actualEntries = output ? output.split("\n") : [];
  if (actualEntries.length !== expectedEntries.length || actualEntries.some((entry, index) => entry !== expectedEntries[index])) {
    throw new Error(`Release package must contain exactly ${expectedEntries.join(", ")}`);
  }
  return actualEntries;
}

export function packageRelease({ rootDirectory = process.cwd(), expectedVersion, outputPath } = {}) {
  const metadata = validateRelease({ rootDirectory, expectedVersion });
  const archivePath = resolve(rootDirectory, outputPath ?? join("artifacts", `nutrition-day-export-${metadata.version}.zip`));
  mkdirSync(dirname(archivePath), { recursive: true });
  rmSync(archivePath, { force: true });
  run("zip", ["-q", "-j", "-X", archivePath, ...metadata.assetNames], rootDirectory);
  return { ...metadata, archivePath, archiveEntries: assertArchiveLayout(rootDirectory, archivePath, metadata.assetNames) };
}

function assertCleanWorktree(rootDirectory) {
  const status = readOutput("git", ["status", "--porcelain", "--untracked-files=all"], rootDirectory);
  if (status) throw new Error(`Release preparation requires a clean worktree; pre-existing changes found:\n${status}`);
}

export function runRepositoryChecks(rootDirectory = process.cwd()) {
  for (const script of ["typecheck", "test", "lint", "build"]) {
    run("corepack", ["pnpm", "run", script], rootDirectory);
  }
}

function updateMetadata(rootDirectory, version) {
  const packagePath = join(rootDirectory, "package.json");
  const manifestPath = join(rootDirectory, "manifest.json");
  const versionsPath = join(rootDirectory, "versions.json");
  const packageJson = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const versions = readJson(versionsPath);
  packageJson.version = version;
  manifest.version = version;
  versions[version] = manifest.minAppVersion;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
}

export function prepareRelease({ rootDirectory = process.cwd(), impact, runChecks = runRepositoryChecks } = {}) {
  if (typeof impact !== "string" || !RELEASE_IMPACTS.includes(impact) || impact === "unknown") {
    throw new Error("prepare requires an explicit --impact: breaking, feat, fix, perf, docs, test, chore, ci, build, refactor, or style");
  }
  const currentVersion = readJson(join(rootDirectory, "package.json")).version;
  const nextVersion = calculateNextVersion(currentVersion, impact);
  assertCleanWorktree(rootDirectory);
  runChecks(rootDirectory);
  updateMetadata(rootDirectory, nextVersion);
  return { currentVersion, nextVersion, impact, bump: impactToBump(impact) };
}

function parseCliArguments(argumentsList) {
  const cliArguments = argumentsList.filter((argument) => argument !== "--");
  const command = ["prepare", "validate", "package"].includes(cliArguments[0]) ? cliArguments.shift() : "package";
  let impact;
  const impactIndex = cliArguments.indexOf("--impact");
  if (impactIndex !== -1) {
    impact = cliArguments[impactIndex + 1];
    cliArguments.splice(impactIndex, 2);
  }
  return { command, expectedVersion: cliArguments[0], outputPath: cliArguments[1], impact };
}

function runCli() {
  const { command, expectedVersion, outputPath, impact } = parseCliArguments(process.argv.slice(2));
  if (command === "prepare") {
    const result = prepareRelease({ impact });
    console.log(`Release preparation complete: ${result.currentVersion} -> ${result.nextVersion}`);
  } else if (command === "validate") {
    console.log(`Release validation passed for ${validateRelease({ expectedVersion }).version}`);
  } else if (command === "package") {
    console.log(`Release package created -> ${packageRelease({ expectedVersion, outputPath }).archivePath}`);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
