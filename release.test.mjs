import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, it } from "node:test";
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
  assertGeneratedMainJsProvenance,
  packageRelease,
  prepareRelease,
  validateRelease,
} from "./release.mjs";

const fixtureRoots = [];

const notesWithImpact = (version, impact) => `# Release ${version}

Date: 2026-09-02

Impact: ${impact}

Rationale: The release gate must reject incomplete plugin packages before publication.

## Summary

Exports now validate release metadata before packaging.

## User-visible changes

- Rejects mismatched plugin metadata before a release is published.
`;

const validNotes = (version) => notesWithImpact(version, "patch");
const emptyNotes = "";

const majorNotes = (version) => `# Release ${version}

Date: 2026-09-02

Impact: major

Rationale: Existing release metadata is no longer sufficient for this contract.

## Summary

The export contract now requires the new metadata format.

## User-visible changes

- Release preparation now requires an explicit impact classification.

## Breaking changes

- Release preparation now requires an explicit impact classification.

## Migration

- Add the required impact and rationale sections to release notes.
`;

function createFixture({
  version = "0.2.0",
  notes = validNotes(version),
  styles = false,
} = {}) {
  const rootDirectory = mkdtempSync(
    join(tmpdir(), "nutrition-day-export-release-"),
  );
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
  writeFileSync(
    join(rootDirectory, "versions.json"),
    `${JSON.stringify({ [version]: "1.0.0" })}\n`,
  );
  writeFileSync(join(rootDirectory, "main.js"), "/* production bundle */\n");
  writeFileSync(
    join(rootDirectory, "docs", "releases", `${version}.md`),
    notes,
  );
  if (styles) writeFileSync(join(rootDirectory, "styles.css"), ".plugin {}\n");
  return rootDirectory;
}

function runGit(rootDirectory, args) {
  return execFileSync("git", args, {
    cwd: rootDirectory,
    encoding: "utf8",
  }).trim();
}

beforeEach(() => fixtureRoots.splice(0));
afterEach(() => {
  for (const rootDirectory of fixtureRoots)
    rmSync(rootDirectory, { recursive: true, force: true });
});

if (process.env.VITEST) {
  globalThis.test("loads the Node release tests under Vitest", () => {
    assert.equal(typeof classifyAdvisory, "function");
  });
}

describe("release impact classification", () => {
  it("classifies conventional advisories and structured messages", () => {
    assert.equal(classifyAdvisory(""), "unknown");
    assert.equal(classifyAdvisory("   \n"), "unknown");
    assert.equal(classifyAdvisory("major"), "unknown");
    assert.equal(classifyAdvisory("patch"), "unknown");
    assert.equal(classifyAdvisory("BREAKING CHANGE:"), "unknown");
    assert.equal(classifyAdvisory("fix: correct nutrition export"), "patch");
    assert.equal(
      classifyAdvisory({ type: "feat", title: "Add date picker" }),
      "minor",
    );
    assert.equal(
      classifyAdvisory("docs(release): document BRAT assets"),
      "none",
    );
    assert.equal(classifyAdvisory("feat!: change export format"), "major");
    assert.equal(
      classifyAdvisory(
        "feat: change export format\n\nBREAKING CHANGE: migrate callers",
      ),
      "major",
    );
    assert.equal(
      classifyAdvisory(
        "feat: change export format\n\nBREAKING-CHANGE: migrate callers",
      ),
      "major",
    );
    assert.equal(
      classifyAdvisory({
        header: "fix: change export format",
        footer: "BREAKING-CHANGE: migrate callers",
      }),
      "major",
    );
    assert.equal(classifyAdvisory("BREAKING CHANGE: migrate callers"), "major");
    assert.equal(classifyAdvisory("BREAKING-CHANGE: migrate callers"), "major");
    assert.equal(
      classifyAdvisory(
        "fix: change export format\nBREAKING CHANGE: migrate callers",
      ),
      "major",
    );
  });

  it("accepts the agreed message input for release:classify", () => {
    const output = execFileSync(
      process.execPath,
      [
        "release.mjs",
        "classify",
        "--message",
        "fix: change export format\n\nBREAKING-CHANGE: migrate callers",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(output, "major\n");
  });

  it("uses major, minor, then patch precedence for mixed advisories", () => {
    assert.equal(
      classifyAdvisory(["fix: patch", "feat: capability", "feat!: migration"]),
      "major",
    );
    assert.equal(classifyAdvisory(["fix: patch", "feat: capability"]), "minor");
    assert.equal(classifyAdvisory(["fix: patch", "docs: notes"]), "patch");
    assert.equal(classifyAdvisory(["docs: notes", ""]), "unknown");
    assert.equal(
      classifyAdvisory(["fix: patch", "unclassified change"]),
      "unknown",
    );
    assert.equal(
      classifyAdvisory(["feat!: breaking capability", "unclassified change"]),
      "unknown",
    );
    assert.equal(
      classifyAdvisory("BREAKING-CHANGE: migrate release metadata"),
      "major",
    );
    assert.equal(calculateNextVersion("0.2.0", "major"), "1.0.0");
    assert.equal(calculateNextVersion("0.2.0", "minor"), "0.3.0");
    assert.equal(calculateNextVersion("0.2.0", "patch"), "0.2.1");
    assert.equal(calculateNextVersion("0.0.9", "minor"), "0.1.0");
    assert.equal(calculateNextVersion("0.0.9", "major"), "1.0.0");
    assert.equal(
      calculateNextVersion(
        "9007199254740993.9007199254740993.9007199254740993",
        "patch",
      ),
      "9007199254740993.9007199254740993.9007199254740994",
    );
    assert.equal(
      calculateNextVersion("9007199254740993.9007199254740993.0", "minor"),
      "9007199254740993.9007199254740994.0",
    );
    assert.equal(
      calculateNextVersion("9007199254740993.0.0", "major"),
      "9007199254740994.0.0",
    );
  });

  it("keeps unknown impact blocking instead of guessing a bump", () => {
    assert.equal(
      classifyAdvisory("maintenance work without a release signal"),
      "unknown",
    );
    for (const impact of ["none", "unknown"]) {
      assert.equal(impactToBump(impact), null);
      assert.throws(
        () => calculateNextVersion("0.2.0", impact),
        /Unknown release impact/,
      );
      assert.throws(
        () =>
          prepareRelease({
            rootDirectory: createFixture(),
            impact,
            runChecks: () => {},
          }),
        /explicit --impact/,
      );
    }
  });
});

describe("release notes and metadata validation", () => {
  it("accepts authored notes and returns their path and body", () => {
    const rootDirectory = createFixture();
    const result = validateRelease({ rootDirectory, expectedVersion: "0.2.0" });
    assert.equal(result.version, "0.2.0");
    assert.equal(result.manifestId, "nutrition-day-export");
    assert.equal(
      result.notesPath,
      join(rootDirectory, "docs", "releases", "0.2.0.md"),
    );
    assert.equal(result.notes, readFileSync(result.notesPath, "utf8"));
  });

  it("accepts none and unknown impact fixtures for validation", () => {
    for (const impact of ["none", "unknown"]) {
      const rootDirectory = createFixture({
        notes: notesWithImpact("0.2.0", impact),
      });
      assert.equal(validateRelease({ rootDirectory }).impact, impact);
    }
  });

  it("rejects missing, generic, malformed, or unsupported notes", () => {
    const invalidNotes = [
      "# Release 0.2.0\n\nDate: 2026-09-02\n\nImpact: patch\n\nRationale: A real release rationale.\n\n## Summary\n\nupdate\n\n## User-visible changes\n\n- A concrete correction for users.\n",
      emptyNotes,
      "# Release 0.2.0\n\nDate: 2026-02-30\n\n## Summary\n\nA real summary.\n\n## Fixed\n\n- A concrete correction for users.\n",
      "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nA real summary.\n\n## Internal\n\n- A concrete correction for users.\n",
      "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nA real summary.\n",
      validNotes("0.2.0").replace(
        "Exports now validate release metadata before packaging.",
        "update\nTODO",
      ),
      validNotes("0.2.0").replace(
        "## User-visible changes",
        "### User-visible changes",
      ),
      validNotes("0.2.0").replace(
        "Impact: patch\n\nRationale: The release gate must reject incomplete plugin packages before publication.",
        "```text\nImpact: patch\nRationale: The release gate must reject incomplete plugin packages before publication.\n```",
      ),
    ];
    for (const notes of invalidNotes) {
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ notes }) }),
        /Release notes/,
      );
    }
    const missingNotesRoot = createFixture();
    rmSync(join(missingNotesRoot, "docs", "releases", "0.2.0.md"));
    assert.throws(
      () => validateRelease({ rootDirectory: missingNotesRoot }),
      /Release notes/,
    );
  });

  it("rejects numeric-only prose in required release-note content", () => {
    const numericOnlyNotes = [
      validNotes("0.2.0").replace(
        "Exports now validate release metadata before packaging.",
        "123456",
      ),
      validNotes("0.2.0").replace(
        "- Rejects mismatched plugin metadata before a release is published.",
        "- 123456",
      ),
      validNotes("0.2.0").replace(
        "Rationale: The release gate must reject incomplete plugin packages before publication.",
        "Rationale: 123456",
      ),
    ];

    for (const notes of numericOnlyNotes) {
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ notes }) }),
        /missing or generic/,
      );
    }
  });

  it("requires impact and rationale sections", () => {
    const rootDirectory = createFixture({
      notes:
        "# Release 0.2.0\n\nDate: 2026-09-02\n\n## Summary\n\nA real summary.\n\n## User-visible changes\n\n- A concrete correction for users.\n",
    });
    assert.throws(() => validateRelease({ rootDirectory }), /Impact:/);

    const rationaleRoot = createFixture({
      notes: validNotes("0.2.0").replace(
        "Rationale: The release gate must reject incomplete plugin packages before publication.\n",
        "",
      ),
    });
    assert.throws(
      () => validateRelease({ rootDirectory: rationaleRoot }),
      /Rationale:/,
    );

    const nonCanonical = createFixture({
      notes: validNotes("0.2.0").replace("Impact: patch", "Impact:  patch"),
    });
    assert.throws(
      () => validateRelease({ rootDirectory: nonCanonical }),
      /Impact:/,
    );
  });

  it("requires canonical release-note field placement and section order", () => {
    const invalidNotes = [
      validNotes("0.2.0").replace(
        "Date: 2026-09-02",
        "Generated release notes\n\nDate: 2026-09-02",
      ),
      validNotes("0.2.0").replace(
        "## Summary",
        "## User-visible changes\n\n- A concrete correction for users.\n\n## Summary",
      ),
      validNotes("0.2.0").replace(
        "## User-visible changes",
        "## Fixed\n\n- A concrete correction for users.\n\n## User-visible changes",
      ),
      `# Release 0.2.0

Date: 2026-09-02

## Summary

Exports now validate release metadata before packaging.

Impact: patch

Rationale: The release gate must reject incomplete plugin packages before publication.

## User-visible changes

- Rejects mismatched plugin metadata before a release is published.
`,
      validNotes("0.2.0").replace(
        "Impact: patch\n\nRationale:",
        "Rationale: The release gate must reject incomplete plugin packages before publication.\n\nImpact: patch",
      ),
    ];

    for (const notes of invalidNotes) {
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ notes }) }),
        /canonical grammar|sections must start|duplicate sections|unsupported section/,
      );
    }
  });

  it("requires breaking changes and migration sections for major impact", () => {
    const rootDirectory = createFixture({ notes: majorNotes("0.2.0") });
    assert.equal(validateRelease({ rootDirectory }).impact, "major");

    const missingMigration = createFixture({
      notes: majorNotes("0.2.0").replace(/\n## Migration[\s\S]*/, "\n"),
    });
    assert.throws(
      () => validateRelease({ rootDirectory: missingMigration }),
      /Migration section/,
    );
  });

  it("rejects major-only and alternative headings for other notes", () => {
    for (const impact of ["patch", "minor", "none", "unknown"]) {
      const notes = notesWithImpact("0.2.0", impact).replace(
        "## User-visible changes",
        "## User-visible changes\n\n- A concrete correction for users.\n\n## Breaking changes\n\n- Existing consumers must update.\n\n## Migration\n\n- Follow the documented upgrade path.",
      );
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ notes }) }),
        /only valid for major impact/,
      );
    }

    for (const heading of [
      "Added",
      "Changed",
      "Fixed",
      "Documentation",
      "Changes",
    ]) {
      const notes = validNotes("0.2.0").replace(
        "## User-visible changes",
        `## ${heading}\n\n- A concrete correction for users.\n\n## User-visible changes`,
      );
      assert.throws(
        () => validateRelease({ rootDirectory: createFixture({ notes }) }),
        /unsupported section|sections must start/,
      );
    }
  });

  it("requires matching package, manifest, version map, and tag metadata", () => {
    const rootDirectory = createFixture();
    const manifestPath = join(rootDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.version = "0.2.1";
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    assert.throws(
      () => validateRelease({ rootDirectory }),
      /manifest.json version/,
    );

    const matchingRoot = createFixture();
    assert.throws(
      () =>
        validateRelease({
          rootDirectory: matchingRoot,
          expectedVersion: "0.2.1",
        }),
      /release tag/,
    );
    const versionsPath = join(matchingRoot, "versions.json");
    writeFileSync(versionsPath, JSON.stringify({ "0.2.0": "1.0.1" }));
    assert.throws(
      () => validateRelease({ rootDirectory: matchingRoot }),
      /versions.json entry/,
    );
  });
});

describe("release assets and side-effect boundaries", () => {
  it("keeps remote release verification for tag, status, assets, and digests", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "release.yml"),
      "utf8",
    );
    assert.match(workflow, /git rev-parse HEAD/);
    assert.match(
      workflow,
      /git ls-remote --tags origin "refs\/tags\/\$RELEASE_TAG\^\{\}"/,
    );
    assert.match(workflow, /\.isDraft == false/);
    assert.match(workflow, /\.isPrerelease == false/);
    assert.match(
      workflow,
      /gh release edit .*--draft=false --prerelease=false/,
    );
    assert.match(
      workflow,
      /gh release create .*--draft=false --prerelease=false/,
    );
    assert.match(workflow, /defaults:\s+run:\s+shell: bash/);
    assert.match(
      workflow,
      /name: Verify tracked generated bundle\s+run: pnpm run release:verify-bundle/,
    );
    assert.match(
      workflow,
      /name: Enforce publishable release impact\s+run: pnpm run release:publish-check -- "\$RELEASE_TAG"/,
    );
    assert.match(
      workflow,
      /Create or update GitHub Release[\s\S]*set -euo pipefail/,
    );
    assert.match(
      workflow,
      /--rawfile body "docs\/releases\/\$RELEASE_TAG\.md"/,
    );
    assert.doesNotMatch(workflow, /notes=\"\$\(cat /);
    assert.match(workflow, /\[\.assets\[\]\.name\] \| sort/);
    assert.match(workflow, /sha256sum/);
    assert.match(workflow, /\{name, digest\}/);
  });

  it("validates required assets and includes optional styles.css", () => {
    const rootDirectory = createFixture({ styles: true });
    assert.deepEqual(validateRelease({ rootDirectory }).assetNames, [
      "main.js",
      "manifest.json",
      "styles.css",
    ]);
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
    assert.deepEqual(result.archiveEntries, [
      "main.js",
      "manifest.json",
      "styles.css",
    ]);
    assert.equal(
      existsSync(join(rootDirectory, "artifacts", "export.zip")),
      true,
    );
  });

  it("validates none and unknown notes but refuses to package them", () => {
    for (const impact of ["none", "unknown"]) {
      const rootDirectory = createFixture({
        notes: notesWithImpact("0.2.0", impact),
      });
      const outputPath = `artifacts/${impact}.zip`;
      assert.equal(validateRelease({ rootDirectory }).impact, impact);
      assert.throws(
        () => packageRelease({ rootDirectory, outputPath }),
        /cannot be published with (none|unknown) impact/,
      );
      assert.equal(existsSync(join(rootDirectory, outputPath)), false);
    }
  });

  it("requires the built main.js to be tracked and match HEAD", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    writeFileSync(
      join(rootDirectory, "main.js"),
      "/*\nTHIS IS A GENERATED/BUNDLED FILE BY ESBUILD\n*/\n",
    );
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    assert.doesNotThrow(() => assertGeneratedMainJsProvenance(rootDirectory));

    writeFileSync(
      join(rootDirectory, "main.js"),
      "/*\nTHIS IS A GENERATED/BUNDLED FILE BY ESBUILD\n*/\nstale bundle\n",
    );
    assert.throws(
      () => assertGeneratedMainJsProvenance(rootDirectory),
      /differs from the tracked checkout after build/,
    );
  });

  it("prepares metadata locally without commit, tag, or publish side effects", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    const initialHead = runGit(rootDirectory, ["rev-parse", "HEAD"]);
    const checks = [];
    const result = prepareRelease({
      rootDirectory,
      impact: "patch",
      runChecks: (directory) => {
        checks.push(directory);
        assert.equal(
          JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
            .version,
          "0.2.1",
        );
        assert.equal(
          JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))
            .version,
          "0.2.1",
        );
        assert.equal(
          JSON.parse(readFileSync(join(directory, "versions.json"), "utf8"))[
            "0.2.1"
          ],
          "1.0.0",
        );
      },
    });

    assert.deepEqual(result, {
      currentVersion: "0.2.0",
      nextVersion: "0.2.1",
      impact: "patch",
      bump: "patch",
    });
    assert.deepEqual(checks, [rootDirectory]);
    assert.equal(runGit(rootDirectory, ["rev-parse", "HEAD"]), initialHead);
    assert.equal(runGit(rootDirectory, ["tag", "--list"]), "");
    assert.equal(
      existsSync(join(rootDirectory, "docs", "releases", "0.2.1.md")),
      false,
    );
    assert.match(
      runGit(rootDirectory, ["status", "--porcelain"]),
      /package.json|manifest.json|versions.json/,
    );
  });

  it("restores metadata when a quality gate fails after the version update", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    const originalMetadata = [
      "package.json",
      "manifest.json",
      "versions.json",
    ].map((file) => readFileSync(join(rootDirectory, file), "utf8"));
    let checkedVersion;

    assert.throws(
      () =>
        prepareRelease({
          rootDirectory,
          impact: "patch",
          runChecks: (directory) => {
            checkedVersion = JSON.parse(
              readFileSync(join(directory, "package.json"), "utf8"),
            ).version;
            throw new Error("quality gate failed");
          },
        }),
      /quality gate failed/,
    );

    assert.equal(checkedVersion, "0.2.1");
    assert.deepEqual(
      ["package.json", "manifest.json", "versions.json"].map((file) =>
        readFileSync(join(rootDirectory, file), "utf8"),
      ),
      originalMetadata,
    );
    assert.equal(runGit(rootDirectory, ["status", "--porcelain"]), "");
  });

  it("refuses preparation from a dirty worktree before running checks", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    writeFileSync(join(rootDirectory, "uncommitted.txt"), "keep me\n");
    let checksRun = false;
    assert.throws(
      () =>
        prepareRelease({
          rootDirectory,
          impact: "patch",
          runChecks: () => {
            checksRun = true;
          },
        }),
      /clean worktree/,
    );
    assert.equal(checksRun, false);
    assert.equal(
      JSON.parse(readFileSync(join(rootDirectory, "package.json"), "utf8"))
        .version,
      "0.2.0",
    );
  });

  it("refuses preparation from a staged dirty worktree before running checks", () => {
    const rootDirectory = createFixture();
    runGit(rootDirectory, ["init", "-q", "-b", "main"]);
    runGit(rootDirectory, ["config", "user.name", "Release Test"]);
    runGit(rootDirectory, [
      "config",
      "user.email",
      "release-test@example.invalid",
    ]);
    runGit(rootDirectory, ["add", "."]);
    runGit(rootDirectory, ["commit", "-qm", "fixture"]);
    writeFileSync(join(rootDirectory, "staged.txt"), "keep me staged\n");
    runGit(rootDirectory, ["add", "staged.txt"]);
    let checksRun = false;
    assert.throws(
      () =>
        prepareRelease({
          rootDirectory,
          impact: "patch",
          runChecks: () => {
            checksRun = true;
          },
        }),
      /clean worktree/,
    );
    assert.equal(checksRun, false);
    assert.equal(
      JSON.parse(readFileSync(join(rootDirectory, "package.json"), "utf8"))
        .version,
      "0.2.0",
    );
  });
});
