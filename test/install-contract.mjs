#!/usr/bin/env node
/**
 * Checks the repository root against the contract Tinycast's "Install from GitHub" route relies on.
 *
 * That route downloads the folder, runs `npm install --ignore-scripts` and then the manifest's build
 * script, and installs from the directory the build wrote to — copying only `package.json`, one
 * `<command-name>.js` per command, and `assets/`. Everything asserted here is something the installer
 * or the runtime itself requires, plus the two rules that keep the build path deterministic.
 *
 *   node test/install-contract.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const read = (p) => readFileSync(join(root, p));

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  \u001b[32mok\u001b[0m   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  \u001b[31mFAIL\u001b[0m ${label}\n       ${error.message}`);
  }
}

console.log(`install layout: ${root}`);

check("a manifest with a name and at least one command", () => {
  assert.match(manifest.name, /^[a-z0-9][a-z0-9-]*$/, "name must be one path segment");
  assert.ok(Array.isArray(manifest.commands) && manifest.commands.length > 0);
});
check("declares macOS support, which the installer checks (extensionPlatforms)", () => {
  assert.ok((manifest.platforms ?? []).includes("macOS"));
});
for (const command of manifest.commands) {
  check(`command "${command.name}" has its built bundle beside the manifest`, () => {
    assert.match(command.name, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(command.title, "needs a title");
    assert.ok(["view", "no-view", "menu-bar"].includes(command.mode), `bad mode ${command.mode}`);
    const bundle = read(`${command.name}.js`).toString("utf8");
    assert.ok(bundle.length > 1000, `${command.name}.js looks empty`);
    assert.match(bundle, /require\("@raycast\/api"\)/);
  });
}
check("the icon the manifest names exists as a 512x512 PNG", () => {
  const icon = read(join("assets", manifest.icon));
  assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(icon.readUInt32BE(16), 512, "width");
  assert.equal(icon.readUInt32BE(20), 512, "height");
});
check("no dependencies: node_modules/.bin/ray must not exist, or the installer builds with it", () => {
  assert.equal(manifest.dependencies, undefined, "a dependency would add the ray toolchain");
  assert.equal(manifest.devDependencies, undefined);
});
check("the manifest carries the build script the installer runs", () => {
  assert.equal(manifest.scripts?.build, "node build.mjs");
});
check("preference defaults are usable as-is", () => {
  const prefs = Object.fromEntries(manifest.preferences.map((p) => [p.name, p]));
  for (const name of ["url", "apiUrl"]) {
    const value = prefs[name].default;
    assert.match(value, /^https:\/\/[^/]+$/, `${name} must be an https origin with no trailing slash`);
    assert.equal(prefs[name].required, true);
  }
  assert.notEqual(prefs.url.default, prefs.apiUrl.default, "docs site vs API: keep them explicit");
  const durations = prefs.duration.data.map((d) => d.value);
  assert.ok(durations.includes(prefs.duration.default));
  assert.equal(typeof prefs.oneTime.default, "boolean");
});
check("the committed bundle is up to date with src/ and vendor/", () => {
  const result = spawnSync(process.execPath, ["build.mjs", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, (result.stdout + result.stderr).trim());
});
check("nothing that ships contains a private host or a machine path", () => {
  // Assembled from fragments on purpose: this guards against a private host creeping back into a
  // public repository, so the string it forbids must not itself appear here in greppable form.
  const forbidden = new RegExp(["kosm" + "iq", "/Us" + "ers/", "camp" + "y"].join("|"), "i");
  const shipped = ["package.json", ...manifest.commands.map((c) => `${c.name}.js`), "README.md"];
  for (const file of shipped) {
    const line = read(file).toString("utf8").split("\n").find((l) => forbidden.test(l));
    assert.equal(line, undefined, `${file}: ${line?.slice(0, 80)}`);
  }
});
check("the licence and vendor notices are present", () => {
  for (const file of ["LICENSE", "NOTICE", "CONTRIBUTING.md", "SECURITY.md", "vendor/README.md", "vendor/LICENSE.LGPL-3.0.txt", "assets/README.md"]) {
    assert.ok(statSync(join(root, file)).size > 100, `${file} is missing or empty`);
  }
});
check("LICENSE is plain MIT, so GitHub detects the licence (no appended notices)", () => {
  const licence = read("LICENSE").toString("utf8");
  assert.match(licence, /^MIT License\n\nCopyright \(c\) \d{4} /);
  assert.match(licence, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.ok(!/third-party/i.test(licence), "third-party notices belong in NOTICE");
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
