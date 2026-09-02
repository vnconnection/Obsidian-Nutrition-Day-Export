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
export const RELEASE_IMPACTS = ["major", "minor", "patch", "none", "unknown"];

const CLASSIFIER_RANK = new Map(
  RELEASE_IMPACTS.map((impact, index) => [impact, index]),
);
const PATCH_TYPES = new Set(["fix", "perf"]);
const NONE_TYPES = new Set([
  "docs",
  "test",
  "tests",
  "chore",
  "ci",
  "build",
  "refactor",
  "style",
]);
const CONVENTIONAL_HEADER_PATTERN =
  /^([a-z][a-z0-9-]*)(?:\([^\r\n()]+\))?(!)?:[ \t]+\S.*$/i;
const BREAKING_FOOTER_PATTERN = /^BREAKING(?:-| )CHANGE:[ \t]*\S.*$/i;
const BREAKING_FOOTER_PREFIX_PATTERN = /^BREAKING(?:-| )CHANGE/i;
const STRUCTURED_COMMIT_FIELDS = new Set([
  "body",
  "description",
  "footer",
  "header",
  "message",
  "scope",
  "subject",
  "title",
  "type",
]);
const NOTE_HEADINGS = new Set([
  "Summary",
  "User-visible changes",
  "Breaking changes",
  "Migration",
]);
const MAJOR_ONLY_NOTE_HEADINGS = new Set(["Breaking changes", "Migration"]);
const ASSET_NAMES = ["main.js", "manifest.json"];
const RELEASE_FIELD_PATTERN = /^\s*(?:Date|Impact|Rationale)\s*:/i;

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
  if (
    !existsSync(path) ||
    !statSync(path).isFile() ||
    statSync(path).size === 0
  ) {
    throw new Error(`${label} is missing or empty: ${path}`);
  }
}

function assertBareSemver(version, label) {
  if (typeof version !== "string" || !SEMVER_TAG_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact bare X.Y.Z semver: ${version}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(advisory, field) {
  if (!Object.hasOwn(advisory, field)) return null;
  return typeof advisory[field] === "string" ? advisory[field] : undefined;
}

function advisoryText(advisory) {
  if (typeof advisory === "string") {
    return advisory;
  }
  if (!isRecord(advisory)) return "";

  if (
    Object.keys(advisory).some((field) => !STRUCTURED_COMMIT_FIELDS.has(field))
  ) {
    return "";
  }

  const message = stringField(advisory, "message");
  const header = stringField(advisory, "header");
  const type = stringField(advisory, "type");
  const scope = stringField(advisory, "scope");
  const subject = stringField(advisory, "subject");
  const title = stringField(advisory, "title");
  const description = stringField(advisory, "description");
  const body = stringField(advisory, "body");
  const footer = stringField(advisory, "footer");
  if (
    [
      message,
      header,
      type,
      scope,
      subject,
      title,
      description,
      body,
      footer,
    ].some((value) => value === undefined)
  ) {
    return "";
  }
  if (footer !== null && !footer.trim()) return "";

  const subjectFields = [subject, title, description].filter(
    (value) => value !== null,
  );
  const headerFields = [header, type, ...subjectFields].filter(
    (value) => value !== null,
  );
  if (message !== null) {
    if (
      headerFields.length > 0 ||
      scope !== null ||
      body !== null ||
      footer !== null
    ) {
      return "";
    }
    return message;
  }
  if (header !== null) {
    if (
      headerFields.length !== 1 ||
      scope !== null ||
      !header.trim() ||
      /\r?\n/.test(header)
    ) {
      return "";
    }
  } else {
    const subjectValue = subjectFields[0];
    if (
      !type?.trim() ||
      !subjectValue?.trim() ||
      subjectFields.length !== 1 ||
      /[\r\n()]/.test(type) ||
      /[\r\n()]/.test(scope ?? "") ||
      /\r?\n/.test(subjectValue)
    ) {
      return "";
    }
    const scopeSuffix = scope === null ? "" : `(${scope.trim()})`;
    return [
      `${type.trim()}${scopeSuffix}: ${subjectValue.trim()}`,
      body?.trim(),
      footer?.trim(),
    ]
      .filter((value) => value)
      .join("\n\n");
  }

  return [header.trim(), body?.trim(), footer?.trim()]
    .filter((value) => value)
    .join("\n\n");
}

function classifySingleAdvisory(advisory) {
  const text = advisoryText(advisory).trim();
  const normalizedText = text.toLowerCase();
  if (!normalizedText) return "unknown";

  const lines = text.split(/\r?\n/);
  const headerMatch = CONVENTIONAL_HEADER_PATTERN.exec(lines[0].trim());
  if (!headerMatch) return "unknown";

  const footerLines = lines.slice(1).map((line) => line.trim());
  const breakingFooterIndexes = footerLines.flatMap((line, index) =>
    BREAKING_FOOTER_PATTERN.test(line) ||
    BREAKING_FOOTER_PREFIX_PATTERN.test(line)
      ? [index]
      : [],
  );
  if (
    footerLines.some(
      (line) =>
        BREAKING_FOOTER_PREFIX_PATTERN.test(line) &&
        !BREAKING_FOOTER_PATTERN.test(line),
    ) ||
    breakingFooterIndexes.some(
      (index) => index !== footerLines.findLastIndex((line) => line.length > 0),
    )
  ) {
    return "unknown";
  }
  if (
    breakingFooterIndexes.length > 0 &&
    lines[breakingFooterIndexes[0] + 1]?.trim() &&
    lines[breakingFooterIndexes[0]].trim()
  ) {
    return "unknown";
  }
  const hasBreakingFooter = breakingFooterIndexes.length > 0;
  if (headerMatch[2] === "!" || hasBreakingFooter) return "major";

  const type = headerMatch[1].toLowerCase();
  if (type === "feat") return "minor";
  if (PATCH_TYPES.has(type)) return "patch";
  if (NONE_TYPES.has(type)) return "none";
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

export function readRepositoryAdvisories(rootDirectory = process.cwd()) {
  let history;
  try {
    history = execFileSync("git", ["log", "--format=%B%x00"], {
      cwd: rootDirectory,
      encoding: "utf8",
    });
  } catch {
    return [];
  }
  return history
    .split("\0")
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
}

export function impactToBump(impact) {
  return RELEASE_IMPACTS.includes(impact) &&
    impact !== "none" &&
    impact !== "unknown"
    ? impact
    : null;
}

export function assertPublishableImpact(impact) {
  if (!impactToBump(impact)) {
    throw new Error(
      `Release cannot be published with ${impact} impact; only major, minor, or patch impacts are publishable`,
    );
  }
  return impact;
}

export function calculateNextVersion(currentVersion, impact) {
  assertBareSemver(currentVersion, "Current package version");
  const bump = impactToBump(impact);
  if (!bump) {
    throw new Error(`Unknown release impact: ${impact}`);
  }
  const [major, minor, patch] = currentVersion.split(".").map(BigInt);
  if (bump === "major") return `${major + 1n}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

function assetNames(rootDirectory) {
  const assets = [...ASSET_NAMES];
  if (existsSync(join(rootDirectory, "styles.css"))) assets.push("styles.css");
  return assets;
}

function sectionBody(notes, heading) {
  const { lines, headings } = notes;
  const headingIndex = headings.findIndex((entry) => entry.name === heading);
  if (headingIndex === -1) return "";
  const currentHeading = headings[headingIndex];
  const nextHeading = headings[headingIndex + 1];
  return lines
    .slice(currentHeading.lineIndex + 1, nextHeading?.lineIndex ?? lines.length)
    .join("\n")
    .trim();
}

function isGenericText(text) {
  const normalizedText = text
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\[[^\]]*\]\s*/gm, "")
    .trim();
  return /^(?:update|todo|tbd|n\/a|tbc|major|minor|patch|none|unknown|fix|feature|breaking|migration|user-visible .+|required only when applicable)\.?$/i.test(
    normalizedText,
  );
}

function hasMeaningfulProse(text) {
  return text.split(/\r?\n/).some((line) => {
    const normalizedLine = line
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\[[^\]]*\]\s*/, "")
      .trim();
    return (
      normalizedLine.length >= 3 &&
      /\p{L}/u.test(normalizedLine) &&
      !isGenericText(normalizedLine)
    );
  });
}

function assertMeaningfulSection(notes, heading, notesPath) {
  const body = sectionBody(notes, heading)
    .split(/\r?\n/)
    .filter((line) => !RELEASE_FIELD_PATTERN.test(line.trim()))
    .join("\n")
    .trim();
  if (!hasMeaningfulProse(body)) {
    throw new Error(
      `Release notes ${heading} section is missing or generic: ${notesPath}`,
    );
  }
  return body;
}

function parseHeading(line) {
  const match = /^(#{1,6})(?:[ \t]+|$)([^\r\n]*?[^\r\n \t])?$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, name: match[2] ?? "" };
}

function parseAuthoredNotes(notes, notesPath) {
  const lines = notes.split(/\r?\n/);
  const activeLines = [];
  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const closesFence =
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        !fenceMatch[2].trim();
      if (closesFence) {
        fence = null;
      } else if (RELEASE_FIELD_PATTERN.test(line.trim())) {
        throw new Error(
          `Release notes contain a release field inside a code fence: ${notesPath}`,
        );
      }
      continue;
    }
    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0],
        length: fenceMatch[1].length,
      };
      continue;
    }
    activeLines.push(line);
  }
  if (fence) {
    throw new Error(
      `Release notes contain an unclosed code fence: ${notesPath}`,
    );
  }

  const headings = [];
  activeLines.forEach((line, lineIndex) => {
    const heading = parseHeading(line);
    if (!heading) {
      if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)) {
        throw new Error(
          `Release notes contain an unsupported heading: ${line.trim()}`,
        );
      }
      return;
    }
    if (lineIndex === 0 && heading.level === 1) {
      return;
    }
    if (heading.level !== 2) {
      throw new Error(
        `Release notes contain an unsupported heading: ${line.trim()}`,
      );
    }
    if (!NOTE_HEADINGS.has(heading.name)) {
      throw new Error(
        `Release notes contain an unsupported section: ${heading.name}`,
      );
    }
    headings.push({ ...heading, lineIndex });
  });
  return { lines: activeLines, headings };
}

function assertReleaseNotes(rootDirectory, version) {
  const notesPath = join(
    rootDirectory,
    RELEASE_NOTES_DIRECTORY,
    `${version}.md`,
  );
  assertNonEmptyFile(notesPath, "Release notes");
  const notes = readFileSync(notesPath, "utf8");
  const rawNoteLines = notes.split(/\r?\n/);
  if (rawNoteLines[0] !== `# Release ${version}`) {
    throw new Error(
      `Release notes heading must be # Release ${version}: ${notesPath}`,
    );
  }
  const parsedNotes = parseAuthoredNotes(notes, notesPath);
  const noteLines = parsedNotes.lines;
  if (noteLines[0] !== `# Release ${version}`) {
    throw new Error(
      `Release notes heading must be # Release ${version}: ${notesPath}`,
    );
  }
  const dateLines = noteLines.filter((line) => line.startsWith("Date:"));
  const dateMatch =
    dateLines.length === 1
      ? /^Date: (\d{4}-\d{2}-\d{2})$/.exec(dateLines[0])
      : null;
  const date = dateMatch ? new Date(`${dateMatch[1]}T00:00:00.000Z`) : null;
  if (
    !dateMatch ||
    !date ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== dateMatch[1]
  ) {
    throw new Error(`Release notes date is missing or invalid: ${notesPath}`);
  }
  const headingNames = parsedNotes.headings.map(({ name }) => name);
  if (
    parsedNotes.headings[0]?.name !== "Summary" ||
    parsedNotes.headings[1]?.name !== "User-visible changes"
  ) {
    throw new Error(
      `Release notes sections must start with Summary and User-visible changes: ${notesPath}`,
    );
  }
  if (new Set(headingNames).size !== headingNames.length) {
    throw new Error(`Release notes contain duplicate sections: ${notesPath}`);
  }
  if (headingNames.filter((heading) => heading === "Summary").length !== 1) {
    throw new Error(
      `Release notes Summary section is missing or duplicated: ${notesPath}`,
    );
  }
  if (
    headingNames.filter((heading) => heading === "User-visible changes")
      .length !== 1
  ) {
    throw new Error(
      `Release notes User-visible changes section is missing or duplicated: ${notesPath}`,
    );
  }

  const firstSectionLine = parsedNotes.headings[0].lineIndex;
  const dateLineIndexes = [];
  const impactLineIndexes = [];
  const rationaleLineIndexes = [];
  const fieldLikeLines = [];
  noteLines.forEach((line, lineIndex) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("Date:")) dateLineIndexes.push(lineIndex);
    if (trimmedLine.startsWith("Impact:")) impactLineIndexes.push(lineIndex);
    if (trimmedLine.startsWith("Rationale:")) {
      rationaleLineIndexes.push(lineIndex);
    }
    if (RELEASE_FIELD_PATTERN.test(line)) fieldLikeLines.push(lineIndex);
  });

  const nonCanonicalFieldLine = fieldLikeLines.find(
    (lineIndex) => !/^(?:Date|Impact|Rationale): /.test(noteLines[lineIndex]),
  );
  if (nonCanonicalFieldLine !== undefined) {
    throw new Error(
      `Release notes contain a non-canonical release field: ${notesPath}`,
    );
  }
  if (
    dateLineIndexes.some((lineIndex) => lineIndex >= firstSectionLine) ||
    impactLineIndexes.some((lineIndex) => lineIndex >= firstSectionLine) ||
    rationaleLineIndexes.some((lineIndex) => lineIndex >= firstSectionLine) ||
    fieldLikeLines.some((lineIndex) => lineIndex >= firstSectionLine) ||
    (dateLineIndexes.length === 1 &&
      impactLineIndexes.length === 1 &&
      rationaleLineIndexes.length === 1 &&
      !(
        dateLineIndexes[0] < impactLineIndexes[0] &&
        impactLineIndexes[0] < rationaleLineIndexes[0]
      )) ||
    noteLines.some(
      (line, lineIndex) =>
        lineIndex > 0 &&
        lineIndex < firstSectionLine &&
        line.trim() &&
        !/^(?:Date|Impact|Rationale): /.test(line),
    )
  ) {
    throw new Error(
      `Release notes do not follow the canonical grammar: ${notesPath}`,
    );
  }
  assertMeaningfulSection(parsedNotes, "Summary", notesPath);
  assertMeaningfulSection(parsedNotes, "User-visible changes", notesPath);
  const impactLines = noteLines.filter((line) => line.startsWith("Impact:"));
  const rationaleLines = noteLines.filter((line) =>
    line.startsWith("Rationale:"),
  );
  const impactMatches =
    impactLines.length === 1
      ? [
          ...impactLines[0].matchAll(
            /^Impact: (major|minor|patch|none|unknown)$/g,
          ),
        ]
      : [];
  const rationaleMatches =
    rationaleLines.length === 1
      ? [...rationaleLines[0].matchAll(/^Rationale: (\S.*)$/g)]
      : [];
  if (impactMatches.length !== 1) {
    throw new Error(
      `Release notes Impact: field is missing or invalid: ${notesPath}`,
    );
  }
  if (
    rationaleMatches.length !== 1 ||
    !hasMeaningfulProse(rationaleMatches[0]?.[1] ?? "")
  ) {
    throw new Error(
      `Release notes Rationale: field is missing or generic: ${notesPath}`,
    );
  }
  const noteImpact = impactMatches[0][1];

  const majorOnlySections = headingNames.filter((heading) =>
    MAJOR_ONLY_NOTE_HEADINGS.has(heading),
  );
  if (noteImpact !== "major" && majorOnlySections.length > 0) {
    throw new Error(
      `Release notes ${majorOnlySections.join(", ")} sections are only valid for major impact: ${notesPath}`,
    );
  }
  if (impactToBump(noteImpact) === "major") {
    assertMeaningfulSection(parsedNotes, "Breaking changes", notesPath);
    assertMeaningfulSection(parsedNotes, "Migration", notesPath);
  }

  return { notesPath, notes, impact: noteImpact };
}

export function validateRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
} = {}) {
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
  assertBareSemver(manifest.version, "manifest.json version");
  if (manifest.version !== packageVersion) {
    throw new Error(
      `manifest.json version (${manifest.version}) does not match package.json version (${packageVersion})`,
    );
  }
  if (expectedVersion !== undefined) {
    assertBareSemver(expectedVersion, "Expected release version");
    if (expectedVersion !== packageVersion) {
      throw new Error(
        `package.json version (${packageVersion}) does not match release tag (${expectedVersion})`,
      );
    }
  }
  const versionsPath = join(rootDirectory, "versions.json");
  if (!existsSync(versionsPath)) throw new Error("versions.json is missing");
  const versions = readJson(versionsPath);
  if (
    typeof manifest.minAppVersion !== "string" ||
    !manifest.minAppVersion.trim() ||
    versions[packageVersion] !== manifest.minAppVersion
  ) {
    throw new Error(
      `versions.json entry for ${packageVersion} does not match manifest.json minAppVersion`,
    );
  }
  const releaseAssets = assetNames(rootDirectory);
  const assetPaths = releaseAssets.map((asset) => join(rootDirectory, asset));
  assetPaths.forEach((assetPath) =>
    assertNonEmptyFile(assetPath, "Release asset"),
  );
  const metadata = {
    version: packageVersion,
    manifestId: manifest.id,
    assetNames: releaseAssets,
    assetPaths,
    ...assertReleaseNotes(rootDirectory, expectedVersion ?? packageVersion),
  };
  assertPublishableImpact(metadata.impact);
  return metadata;
}

export function validatePublishableRelease(options = {}) {
  return validateRelease(options);
}

function assertArchiveLayout(rootDirectory, archivePath, expectedEntries) {
  assertNonEmptyFile(archivePath, "Release package");
  const output = readOutput("unzip", ["-Z1", archivePath], rootDirectory);
  const actualEntries = output ? output.split("\n") : [];
  const actualSet = [...new Set(actualEntries)].sort();
  const expectedSet = [...new Set(expectedEntries)].sort();
  if (
    actualEntries.length !== expectedEntries.length ||
    actualSet.length !== expectedEntries.length ||
    actualSet.some((entry, index) => entry !== expectedSet[index])
  ) {
    throw new Error(
      `Release package must contain exactly ${expectedEntries.join(", ")}`,
    );
  }
  for (const entry of expectedEntries) {
    const archiveBytes = execFileSync("unzip", ["-p", archivePath, entry], {
      cwd: rootDirectory,
    });
    const sourceBytes = readFileSync(join(rootDirectory, entry));
    if (!archiveBytes.equals(sourceBytes)) {
      throw new Error(`Release package entry does not match ${entry}`);
    }
  }
  return actualEntries;
}

export function packageRelease({
  rootDirectory = process.cwd(),
  expectedVersion,
  outputPath,
} = {}) {
  const metadata = validatePublishableRelease({
    rootDirectory,
    expectedVersion,
  });
  const archivePath = resolve(
    rootDirectory,
    outputPath ??
      join("artifacts", `nutrition-day-export-${metadata.version}.zip`),
  );
  mkdirSync(dirname(archivePath), { recursive: true });
  rmSync(archivePath, { force: true });
  run(
    "zip",
    ["-q", "-j", "-X", archivePath, ...metadata.assetNames],
    rootDirectory,
  );
  return {
    ...metadata,
    archivePath,
    archiveEntries: assertArchiveLayout(
      rootDirectory,
      archivePath,
      metadata.assetNames,
    ),
  };
}

function assertCleanWorktree(rootDirectory) {
  const status = readOutput(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    rootDirectory,
  );
  if (status)
    throw new Error(
      `Release preparation requires a clean worktree; pre-existing changes found:\n${status}`,
    );
}

function assertTrackedGeneratedAsset(
  rootDirectory,
  relativePath,
  requiredText,
) {
  let trackedPath;
  try {
    trackedPath = readOutput(
      "git",
      ["ls-files", "--error-unmatch", "--", relativePath],
      rootDirectory,
    );
  } catch {
    throw new Error(`Generated ${relativePath} must be tracked by Git`);
  }
  if (trackedPath !== relativePath) {
    throw new Error(`Generated ${relativePath} must be tracked by Git`);
  }

  const assetPath = join(rootDirectory, relativePath);
  assertNonEmptyFile(assetPath, `Generated ${relativePath}`);
  if (requiredText && !readFileSync(assetPath, "utf8").includes(requiredText)) {
    throw new Error(
      `Generated ${relativePath} is missing its provenance marker`,
    );
  }

  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", relativePath], {
      cwd: rootDirectory,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `Generated ${relativePath} differs from the tracked checkout after build`,
    );
  }
}

export function assertGeneratedMainJsProvenance(rootDirectory = process.cwd()) {
  assertTrackedGeneratedAsset(
    rootDirectory,
    "main.js",
    "THIS IS A GENERATED/BUNDLED FILE BY ESBUILD",
  );
}

export function assertGeneratedArtifactProvenance(
  rootDirectory = process.cwd(),
) {
  assertGeneratedMainJsProvenance(rootDirectory);
  const stylesPath = join(rootDirectory, "styles.css");
  if (!existsSync(stylesPath)) return;

  const sourceStylesPath = join(rootDirectory, "src", "styles.css");
  assertNonEmptyFile(stylesPath, "Generated styles.css");
  assertNonEmptyFile(sourceStylesPath, "Source styles.css");
  if (!readFileSync(stylesPath).equals(readFileSync(sourceStylesPath))) {
    throw new Error("Generated styles.css differs from src/styles.css");
  }
  assertTrackedGeneratedAsset(rootDirectory, "styles.css");
}

export function runRepositoryChecks(rootDirectory = process.cwd()) {
  for (const script of ["typecheck", "test", "lint", "build"]) {
    run("corepack", ["pnpm", "run", script], rootDirectory);
  }
  assertGeneratedArtifactProvenance(rootDirectory);
}

function updateMetadata(rootDirectory, version) {
  const packagePath = join(rootDirectory, "package.json");
  const manifestPath = join(rootDirectory, "manifest.json");
  const versionsPath = join(rootDirectory, "versions.json");
  const metadataPaths = [packagePath, manifestPath, versionsPath];
  const originalContents = new Map(
    metadataPaths.map((path) => [path, readFileSync(path, "utf8")]),
  );
  const packageJson = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const versions = readJson(versionsPath);
  packageJson.version = version;
  manifest.version = version;
  versions[version] = manifest.minAppVersion;
  const restore = () => {
    for (const [path, contents] of originalContents) {
      writeFileSync(path, contents);
    }
  };
  try {
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

export function prepareRelease({
  rootDirectory = process.cwd(),
  impact,
  runChecks = runRepositoryChecks,
} = {}) {
  if (
    typeof impact !== "string" ||
    !["major", "minor", "patch"].includes(impact)
  ) {
    throw new Error(
      "prepare requires an explicit --impact: major, minor, or patch",
    );
  }
  const currentVersion = readJson(join(rootDirectory, "package.json")).version;
  const nextVersion = calculateNextVersion(currentVersion, impact);
  assertCleanWorktree(rootDirectory);
  const restoreMetadata = updateMetadata(rootDirectory, nextVersion);
  try {
    runChecks(rootDirectory);
  } catch (error) {
    restoreMetadata();
    throw error;
  }
  return { currentVersion, nextVersion, impact, bump: impactToBump(impact) };
}

function parseExplicitAdvisory(argument) {
  const value = argument.trim();
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return argument;
    }
  }
  return argument;
}

function parseCliArguments(argumentsList) {
  const cliArguments = argumentsList.filter((argument) => argument !== "--");
  const knownCommands = [
    "classify",
    "prepare",
    "validate",
    "publish-check",
    "verify-bundle",
    "package",
  ];
  const command = knownCommands.includes(cliArguments[0])
    ? cliArguments.shift()
    : "package";
  let impact;
  const suppliedAdvisories = [];
  const positionalArguments = [];
  for (let index = 0; index < cliArguments.length; index += 1) {
    const argument = cliArguments[index];
    if (argument === "--impact") {
      impact = cliArguments[index + 1];
      index += 1;
      continue;
    }
    if (
      argument === "--message" ||
      argument === "-m" ||
      argument === "--input"
    ) {
      suppliedAdvisories.push(
        parseExplicitAdvisory(cliArguments[index + 1] ?? ""),
      );
      index += 1;
      continue;
    }
    const inlinePrefix = ["--message=", "--input="].find((prefix) =>
      argument.startsWith(prefix),
    );
    if (inlinePrefix) {
      suppliedAdvisories.push(
        parseExplicitAdvisory(argument.slice(inlinePrefix.length)),
      );
      continue;
    }
    positionalArguments.push(argument);
  }

  const advisoryArguments =
    suppliedAdvisories.length > 0
      ? [...suppliedAdvisories, ...positionalArguments]
      : positionalArguments;
  return {
    command,
    expectedVersion: positionalArguments[0],
    outputPath: positionalArguments[1],
    impact,
    advisory:
      advisoryArguments.length === 1
        ? advisoryArguments[0]
        : advisoryArguments.length > 1
          ? advisoryArguments
          : undefined,
    hasSuppliedAdvisory: suppliedAdvisories.length > 0,
  };
}

function runCli() {
  const {
    command,
    expectedVersion,
    outputPath,
    impact,
    advisory,
    hasSuppliedAdvisory,
  } = parseCliArguments(process.argv.slice(2));
  if (command === "classify") {
    const classificationInput =
      hasSuppliedAdvisory || advisory !== undefined
        ? advisory
        : readRepositoryAdvisories();
    process.stdout.write(`${classifyAdvisory(classificationInput)}\n`);
  } else if (command === "prepare") {
    const result = prepareRelease({ impact });
    process.stdout.write(
      `Release preparation complete: ${result.currentVersion} -> ${result.nextVersion}`,
    );
  } else if (command === "validate") {
    const metadata = validateRelease({ expectedVersion });
    process.stdout.write(`Release validation passed for ${metadata.version}`);
  } else if (command === "publish-check") {
    const metadata = validatePublishableRelease({ expectedVersion });
    process.stdout.write(
      `Release publish check passed for ${metadata.version}`,
    );
  } else if (command === "verify-bundle") {
    assertGeneratedArtifactProvenance();
    process.stdout.write("Generated artifact provenance check passed");
  } else if (command === "package") {
    process.stdout.write(
      `Release package created -> ${packageRelease({ expectedVersion, outputPath }).archivePath}`,
    );
  } else {
    throw new Error(`Unknown release command: ${command}`);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
