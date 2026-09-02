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
  "major",
  "minor",
  "patch",
  "none",
  "unknown",
];

const PATCH_IMPACTS = new Set([
  "fix",
  "perf",
  "docs",
  "test",
  "chore",
  "ci",
  "build",
  "refactor",
  "style",
  "patch",
]);
const CLASSIFIER_ORDER = [
  "breaking",
  "major",
  "feat",
  "minor",
  ...PATCH_IMPACTS,
  "none",
];
const CLASSIFIER_RANK = new Map(
  CLASSIFIER_ORDER.map((impact, index) => [impact, index]),
);
const NOTE_HEADINGS = new Set([
  "Summary",
  "Impact",
  "Rationale",
  "Added",
  "Changed",
  "Fixed",
  "Breaking changes",
  "Migration",
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
      advisory.footer,
      advisory.description,
    ]
      .filter((value) => typeof value === "string")
      .join("\n");
  }
  return "";
}

function classifySingleAdvisory(advisory) {
  const text = advisoryText(advisory).trim();
  const normalizedText = text.toLowerCase();
  if (!normalizedText) return "unknown";

  if (
    normalizedText === "breaking" ||
    /(?:^|[\r\n])\s*breaking(?:[- ]change)?\s*:/im.test(text) ||
    /\bbreaking[- ]change\b/i.test(text) ||
    /(?:^|[\r\n])\s*[a-z][\w-]*(?:\([^\r\n)]*\))?!\s*(?::|$)/im.test(text)
  ) {
    return "breaking";
  }

  const matchesConventionalType = (impact) =>
    new RegExp(
      `(?:^|[\\s(:])${impact}(?:\\([^)]*\\))?(?=\\s*(?::|!|$|\\r?\\n))`,
      "i",
    ).test(text);

  if (matchesConventionalType("feat") || normalizedText === "minor") {
    return normalizedText === "minor" ? "minor" : "feat";
  }

  for (const impact of PATCH_IMPACTS) {
    if (matchesConventionalType(impact) || normalizedText === impact) {
      return impact;
    }
  }

  if (normalizedText === "major" || normalizedText === "none") {
    return normalizedText;
  }

  return "unknown";
}

export function classifyAdvisory(advisory) {
  if (!Array.isArray(advisory)) return classifySingleAdvisory(advisory);
  if (advisory.length === 0) return "unknown";

  const classifications = advisory.map(classifyAdvisory);
  if (classifications.includes("unknown")) return "unknown";
  return classifications.reduce((highest, current) =>
    CLASSIFIER_RANK.get(current) < CLASSIFIER_RANK.get(highest)
      ? current
      : highest,
  );
}

export const classifyImpact = classifyAdvisory;

export function impactToBump(impact) {
  if (impact === "breaking" || impact === "major") return "major";
  if (impact === "feat" || impact === "minor") return "minor";
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

function sectionBody(notes, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingMatch = notes.match(
    new RegExp(`^## ${escapedHeading}\\s*$`, "m"),
  );
  if (!headingMatch || headingMatch.index === undefined) return "";
  const bodyStart = headingMatch.index + headingMatch[0].length;
  const remainingNotes = notes.slice(bodyStart);
  const nextHeadingOffset = remainingNotes.search(/^## [^\n]+\s*$/m);
  const bodyEnd =
    nextHeadingOffset === -1
      ? notes.length
      : bodyStart + nextHeadingOffset;
  return notes.slice(bodyStart, bodyEnd).trim();
}

function isGenericText(text) {
  const normalizedText = text
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\[[^\]]*\]\s*/gm, "")
    .trim();
  return /^(?:update|todo|tbd|n\/a|user-visible .+|required only when applicable)\.?$/i.test(
    normalizedText,
  );
}

function assertMeaningfulSection(notes, heading, notesPath) {
  const body = sectionBody(notes, heading);
  if (!body || isGenericText(body)) {
    throw new Error(`Release notes ${heading} section is missing or generic: ${notesPath}`);
  }
  return body;
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
  assertMeaningfulSection(notes, "Summary", notesPath);
  const impactSection = assertMeaningfulSection(notes, "Impact", notesPath);
  assertMeaningfulSection(notes, "Rationale", notesPath);
  const noteImpact = classifyAdvisory(impactSection);
  if (noteImpact === "unknown" || noteImpact === "none") {
    throw new Error(`Release notes Impact must identify a release impact: ${notesPath}`);
  }

  const concreteHeadings = new Set([
    "Added",
    "Changed",
    "Fixed",
    "Breaking changes",
    "Documentation",
  ]);
  const concreteChange = headings.some(([, heading]) => {
    const normalizedHeading = heading.trim();
    if (!concreteHeadings.has(normalizedHeading)) return false;
    const body = sectionBody(notes, normalizedHeading);
    return body.length >= 9 && !isGenericText(body);
  });
  if (!concreteChange) {
    throw new Error(`Release notes must contain a concrete user-visible change: ${notesPath}`);
  }

  if (impactToBump(noteImpact) === "major") {
    assertMeaningfulSection(notes, "Breaking changes", notesPath);
    assertMeaningfulSection(notes, "Migration", notesPath);
  }

  return { notesPath, notes, impact: noteImpact };
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
  if (
    typeof impact !== "string" ||
    !RELEASE_IMPACTS.includes(impact) ||
    impact === "unknown" ||
    impact === "none"
  ) {
    throw new Error(
      "prepare requires an explicit --impact: major, minor, patch, breaking, feat, fix, perf, docs, test, chore, ci, build, refactor, or style",
    );
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
  const knownCommands = ["classify", "prepare", "validate", "package"];
  const command = knownCommands.includes(cliArguments[0])
    ? cliArguments.shift()
    : "package";
  let impact;
  const impactIndex = cliArguments.indexOf("--impact");
  if (impactIndex !== -1) {
    impact = cliArguments[impactIndex + 1];
    cliArguments.splice(impactIndex, 2);
  }
  return {
    command,
    expectedVersion: cliArguments[0],
    outputPath: cliArguments[1],
    impact,
    advisory: cliArguments.join(" "),
  };
}

function runCli() {
  const { command, expectedVersion, outputPath, impact, advisory } =
    parseCliArguments(process.argv.slice(2));
  if (command === "classify") {
    console.log(classifyAdvisory(advisory));
  } else if (command === "prepare") {
    const result = prepareRelease({ impact });
    console.log(`Release preparation complete: ${result.currentVersion} -> ${result.nextVersion}`);
  } else if (command === "validate") {
    console.log(`Release validation passed for ${validateRelease({ expectedVersion }).version}`);
  } else if (command === "package") {
    console.log(`Release package created -> ${packageRelease({ expectedVersion, outputPath }).archivePath}`);
  } else {
    throw new Error(`Unknown release command: ${command}`);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
