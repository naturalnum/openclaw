#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const backendDir = path.join(repoRoot, "power-backend");

function usage() {
  process.stderr.write("Usage: node scripts/power-backend.js <dev|build> [...args]\n");
}

function run(args) {
  const child = spawn("pnpm", args, {
    cwd: backendDir,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (error) => {
    console.error("Failed to launch power-backend:", error);
    process.exit(1);
  });
}

const [action, ...rest] = process.argv.slice(2);
if (!action || !["dev", "build"].includes(action)) {
  usage();
  process.exit(2);
}

run(["run", action, ...rest]);
