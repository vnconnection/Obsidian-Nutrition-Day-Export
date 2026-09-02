import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  afterEach,
  beforeEach,
  describe,
  it,
} from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateNextVersion,
  classifyAdvisory,
  impactToBump,
  packageRelease,
  prepareRelease,
  validateRelease,
} from "./release.mjs";

const fixtureRoots = [];

const validNotes = (version) => `# Release ${version}

Date: 2026-09-02

## Summary

Exports now validate release metadata before packaging.

## Fixed

- Rejects mismatched plugin metadata before a release is published.
`;

function createFixture({ version = "0.2.0", notes = validNotes(version), styles = false } = {}) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "nutrition-day-export-release-"));
  fixtureRoots.push(rootDirectory);
  mkdirSync(join(rootDirectory, "docs", "releases"), { recursive: true });
  writeFileSync(
    join(rootDirectory, "package.json"),
    `${JSON.stringify({ name: "nutrition-day-export", version }, null, 2)}\n`,
  );
  writeFileSync(
    join(rootDirectory, "manifest.json"),
    `${JSON.stringify({ id: "nutrition-day-export", version, minAppVersion: "1.0.0" }, null, 2)}\n`,
  );
  writeFileSync(join(rootDirectory, "versions.json"), `${JSON.stringify({ [version]: "1.0.0" })}\n`);
  writeFileSync(join(rootDirectory, "main.js"), "/* production bundle */\n");
  writeFileSync(join(rootDirectory, "docs", "releases", `${version}.md`), notes);
  if (styles) writeFileSync(join(rootDirectory, "styles.css"), ".plugin {}\n");
  return rootDirectory;
}

function runGit(rootDirectory, args) {
  return execFileSync("git", args, { cwd: rootDirectory, encoding: "utf8" }).trim();
}

beforeEach(() => fixtureRoots.splice(0));
afterEach(() => {
  for (const rootDirectory of fixtureRoots) rmSync(rootDirectory, { recursive: true, force: true });
});

describe("release impact classification", () => {
  it("classifies conventional advisories and structured messages", () => {
    assert.equal(classifyAdvisory("fix: correct nutrition export"), "fix");
    assert.equal(classifyAdvisory({ type: "feat", title: "Add date picker" }), "feat");
    assert.equal(classifyAdvisory("docs(release): document BRAT assets"), "docs");
  });

  it("uses breaking, feature, then patch precedence for mixed advisories", () => {
    assert.equal(classifyAdvisory(["fix: patch", "feat: capability", "breaking change: migration"]), "breaking");
    assert.equal(classifyAdvisory(["fix: patch", "feat: capability"]), "feat");
    assert.equal(classifyAdvisory(["fix: patch", "docs: notes"]), "fix");
    assert.equal(calculateNextVersion("0.2.0", "breaking"), "1.0.0");
    assert.equal(calculateNextVersion("0.2.0", "feat"), "0.3.0");
    assert.equal(calculateNextVersion("0.2.0", "fix"), "0.2.1");
  });

  it("keeps unknown impact blocking instead of guessing a bump", () => {
    assert.equal(classifyAdvisory("maintenance work without a release signal"), "unknown");
    assert.equal(impactToBump("unknown"), null);
    assert.throws(() => calculateNextVersion("0.2.0", "unknown"), /Unknown release impact/);
    assert.throws(
      () => prepareRelease({ rootDirectory: createFixture(), impact: "unknown", runChecks: () => {} }),
      /explicit --impact/,
    );
  });
});

describe("release notes and metadata validation", () => {
  it("accepts authored notes and returns their path and body", () => {
    const rootDirectory = createFixture();
    const result = validateRelease({ rootDirectory, expectedVersion: "0.2.0" });
    assert.equal(result.version, "0.2.0");
    assert.equal(result.manifestId, "nutrition-day-export");
    assert.equal(result.notesPath, join(rootDirectory, "docs", "releases", "0.2.0.md"));
    assert.equal(result.notes, readFileSync(result.notesPath, "utf8"));
  });

  it("rejects missing, generic, malformed, or unsupported notes", () => {
    const invalidNotes = [
      "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nupdate\n",
      "# Release 0.2.0\n\nDate: 2026-02-30\n\n## Summary\n\nA real summary.\n\n## Fixed\n\n- A concrete correction for users.\n",
      "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nA real summary.\n\n## Internal\n\n- A concrete correction for users.\n",
      "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nA real summary.\n",
    ];
    for (const notes of invalidNotes) {
      assert.throws(() => validateRelease({ rootDirectory: createFixture({ notes }) }), /Release notes/);
    }
    const missingNotesRoot = createFixture();
    rmSync(join(missingNotesRoot, "docs", "releases", "0.2.0.md"));
    assert.throws(() => validateRelease({ rootDirectory: missingNotesRoot }), /Release notes/);
  });

  it("requires matching package, manifest, version map, and tag metadata", () => {
    const rootDirectory = createFixture();
    const manifestPath = join(rootDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "0.2.1";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(() => validateRelease({ rootDirectory }), /manifest.json version/);

    const matchingRoot = createFixture();
    assert.throws(() => validateRelease({ rootDirectory: matchingRoot, expectedVersion: "0.2.1" }), /release tag/);
    const versionsPath = join(matchingRoot, "versions.json");
    writeFileSync(versionsPath, JSON.stringify({ "0.2.0": "1.0.1" }));
    assert.throws(() => validateRelease({ rootDirectory: matchingRoot }), /versions.json entry/);
  });
});

describe("release assets and side-effect boundaries", () => {
  it("validates required assets and includes optional styles.css", () => {
    const rootDirectory = createFixture({ styles: true });
    assert.deepEqual(validateRelease({ rootDirectory }).assetNames, ["main.js", "manifest.json", "styles.css"]);
    rmSync(join(rootDirectory, "main.js"));
    assert.throws(() => validateRelease({ rootDirectory }), /Release asset/);
  });

  it("packages exactly the root assets into a ZIP", () => {
    const rootDirectory = createFixture({ styles: true });
    const result = packageRelease({
      rootDirectory,
      expectedVersion: "0.2.0",
      outputPath: "artifacts/export.zip",
    });
    assert.deepEqual(result.archiveEntries, ["main.js", "manifest.json", "styles.css"]);
    assert.equal(existsSync(join(rootDirectory, "artifacts", "export.zip")), true);
  });

  it("prepares metadata locally without commit, tag, or publish side effects", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, ["config", "user.email", "release-test@example.invalid"]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    const initialHead = runGit(rootDirectory, ["rev-parse", "HEAD"]);
    const checks = [];
    const result = prepareRelease({ rootDirectory, impact: "fix", runChecks: (directory) => checks.push(directory) });

    assert.deepEqual(result, { currentVersion: "0.2.0", nextVersion: "0.2.1", impact: "fix", bump: "patch" });
    assert.deepEqual(checks, [rootDirectory]);
    assert.equal(runGit(rootDirectory, ["rev-parse", "HEAD"]), initialHead);
    assert.equal(runGit(rootDirectory, ["tag", "--list"]), "");
    assert.equal(existsSync(join(rootDirectory, "docs", "releases", "0.2.1.md")), false);
    assert.match(runGit(rootDirectory, ["status", "--porcelain"]), /package.json|manifest.json|versions.json/);
  });

  it("refuses preparation from a dirty worktree before running checks", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, ["config", "user.email", "release-test@example.invalid"]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    writeFileSync(join(rootDirectory, "uncommitted.txt"), "keep me\n");
    let checksRun = false;
    assert.throws(
      () => prepareRelease({ rootDirectory, impact: "fix", runChecks: () => { checksRun = true; } }),
      /clean worktree/,
    );
    assert.equal(checksRun, false);
    assert.equal(JSON.parse(readFileSync(join(rootDirectory, "package.json"), "utf8")).version, "0.2.0");
  });
});
