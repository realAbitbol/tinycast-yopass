#!/usr/bin/env node
/**
 * The offline suite: everything that can run without Tinycast, a Yopass instance, or the network.
 * CI runs exactly this.
 *
 *   npm test
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suites = ["install-contract.mjs", "bundle-offline.mjs"];

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [join(here, suite)], { stdio: "inherit" });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) failed += 1;
  console.log(`--- ${suite}: ${result.status === 0 ? "passed" : "FAILED"} in ${seconds}s`);
}

console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);
