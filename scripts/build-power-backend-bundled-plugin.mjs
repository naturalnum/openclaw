#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const pluginRoot = path.join(repoRoot, "power-backend");
const outputDir = path.join(repoRoot, "dist", "extensions", "power-backend");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function writeBundledPackageManifest() {
  const packageJsonPath = path.join(pluginRoot, "package.json");
  const source = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const bundled = {
    name: source.name,
    private: true,
    description: source.description,
    type: "module",
    openclaw: {
      extensions: ["./index.mjs"],
    },
  };
  await fs.writeFile(
    path.join(outputDir, "package.json"),
    `${JSON.stringify(bundled, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  run("pnpm", [
    "exec",
    "tsdown",
    "power-backend/index.ts",
    "--no-config",
    "--format",
    "esm",
    "--platform",
    "node",
    "--target",
    "node24",
    "--clean",
    "--out-dir",
    "dist/extensions/power-backend",
    "--logLevel",
    "warn",
  ]);

  await Promise.all([
    fs.copyFile(
      path.join(pluginRoot, "openclaw.plugin.json"),
      path.join(outputDir, "openclaw.plugin.json"),
    ),
    fs.copyFile(path.join(pluginRoot, "README.md"), path.join(outputDir, "README.md")),
    writeBundledPackageManifest(),
  ]);
}

await main();
