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
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";

const isWin = process.platform === "win32";
const tint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);

// Children inherit PATH; on Windows the key is often "Path".
const env = { ...process.env, FORCE_COLOR: process.stdout.isTTY ? "1" : "0" };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

const works = (command) => spawnSync(command, { shell: true, stdio: "ignore" }).status === 0;

/**
 * uv on PATH, or in the folders its installers use (a fresh install is often not on PATH
 * until the terminal is reopened). When found off PATH, its folder is added for the children.
 */
function findUv() {
  if (works("uv --version")) return "PATH";
  const exe = isWin ? "uv.exe" : "uv";
  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", exe),
    join(home, ".cargo", "bin", exe),
    ...(isWin && process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, "Programs", "uv", exe)]
      : []),
    ...(isWin ? [] : ["/opt/homebrew/bin/uv", "/usr/local/bin/uv"]),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (found) env[pathKey] = `${dirname(found)}${delimiter}${env[pathKey] ?? ""}`;
  return found ?? null;
}

const uv = findUv();
const UV_INSTALL = isWin
  ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
  : "curl -LsSf https://astral.sh/uv/install.sh | sh";
const missingUv = () =>
  console.log(
    `\n${tint(31, "✗ uv not found, so the analysis service (patterns, zones, statistics) is NOT running.")}\n` +
      `  Install uv (it installs Python 3.12 itself), close and reopen this terminal, then run npm start:\n` +
      `    ${tint(1, UV_INSTALL)}\n` +
      "  More: https://docs.astral.sh/uv/getting-started/installation/\n",
  );

const services = [
  uv && { name: "api", color: 35, cmd: "npm run api" },
  { name: "web", color: 36, cmd: "npm run dev", essential: true },
  !process.argv.includes("--no-telegram") && {
    name: "telegram",
    color: 33,
    cmd: "npm run backend",
  },
].filter(Boolean);

if (!uv) missingUv();
else if (uv !== "PATH") console.log(tint(2, `Using uv at ${uv} (not on PATH yet).`));

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
    env,
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
if (!uv) setTimeout(missingUv, 4000).unref();
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
