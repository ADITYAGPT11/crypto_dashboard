#!/usr/bin/env node
/**
 * `npm start`: everything the product needs, in one terminal.
 *
 * - api       Python analysis service on :8000 (`npm run api`; needs uv)
 * - web       Vite+ dev server on :3000 (`npm run dev`)
 * - telegram  Node prototype on :3001 for Telegram alerts (`npm run backend`; skip: --no-telegram)
 *
 * Output is prefixed per process. One process failing never stops the others, except the web
 * app: without it there is nothing to open, so everything stops. Ctrl+C stops all of them.
 */
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const isWin = process.platform === "win32";
const has = (cmd) => spawnSync(cmd, ["--version"], { shell: true, stdio: "ignore" }).status === 0;
const tint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);

const hasUv = has("uv");
const services = [
  hasUv && { name: "api", color: 35, cmd: "npm run api" },
  { name: "web", color: 36, cmd: "npm run dev", essential: true },
  !process.argv.includes("--no-telegram") && {
    name: "telegram",
    color: 33,
    cmd: "npm run backend",
  },
].filter(Boolean);

if (!hasUv) {
  console.log(
    tint(31, "uv not found: the analysis service (patterns, zones, statistics) will not start.\n") +
      "Install it from https://docs.astral.sh/uv/getting-started/installation/ and run npm start again.\n",
  );
}

const width = Math.max(...services.map((s) => s.name.length));
const running = new Map();
let stopping = false;

function pipe(service, stream, out) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines)
      out.write(`${tint(service.color, service.name.padEnd(width))} │ ${line}\n`);
  });
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log(tint(2, "\nStopping…"));
  for (const child of running.values()) {
    try {
      if (isWin)
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const service of services) {
  const child = spawn(service.cmd, {
    shell: true,
    detached: !isWin, // own process group, so Ctrl+C stops the whole tree
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" },
  });
  running.set(service.name, child);
  pipe(service, child.stdout, process.stdout);
  pipe(service, child.stderr, process.stderr);
  child.on("exit", (code) => {
    running.delete(service.name);
    if (stopping) return;
    console.log(tint(31, `${service.name} exited (code ${code ?? "signal"})`));
    if (service.essential) stopAll(code ?? 1);
    else if (running.size === 0) process.exit(code ?? 1);
  });
}

console.log(
  `${tint(1, "Starting")} ${services.map((s) => s.name).join(", ")} · open ${tint(1, "http://localhost:3000")} · Ctrl+C stops all\n`,
);
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
