import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
if (process.platform !== "darwin")
  throw Error("The installer currently supports macOS launchd");
for (const name of [
  "GCLOUD_BIN",
  "CLOUDSDK_CONFIG",
  "CLOUDSDK_PYTHON",
  "DOCKER_BIN",
])
  if (!process.env[name])
    throw Error(`Set ${name} to an existing installation path`);
const directory = resolve(
  process.env.MERIDIAN_BRIDGE_DATA ||
    `${process.env.HOME}/Library/Application Support/Helix Meridian Bridge`,
);
const label = "local.helix.meridian-bridge";
const agent = resolve(
  process.env.HOME,
  "Library/LaunchAgents",
  label + ".plist",
);
const escape = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
await mkdir(dirname(agent), { recursive: true });
await mkdir(directory, { recursive: true, mode: 0o700 });
const environment = Object.fromEntries(
  [
    "GCLOUD_BIN",
    "CLOUDSDK_CONFIG",
    "CLOUDSDK_PYTHON",
    "DOCKER_BIN",
    "MERIDIAN_BUCKET",
    "MERIDIAN_EXPORT_IMAGE",
    "MERIDIAN_BRIDGE_PORT",
  ]
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
environment.MERIDIAN_BRIDGE_DATA = directory;
environment.PATH = `${dirname(process.env.DOCKER_BIN)}:/usr/bin:/bin:/usr/sbin:/sbin`;
const values = {
  Label: label,
  StandardOutPath: resolve(directory, "service.log"),
  StandardErrorPath: resolve(directory, "error.log"),
};
const plist =
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>' +
  Object.entries(values)
    .map(([k, v]) => `<key>${k}</key><string>${escape(v)}</string>`)
    .join("") +
  `<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(resolve(dirname(fileURLToPath(import.meta.url)), "server.mjs"))}</string></array>` +
  "<key>EnvironmentVariables</key><dict>" +
  Object.entries(environment)
    .map(([k, v]) => `<key>${k}</key><string>${escape(v)}</string>`)
    .join("") +
  "</dict>" +
  "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer></dict></plist>";
let previous;
try {
  previous = await readFile(agent, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (previous && previous !== plist)
  throw Error(
    "Existing adapter launch configuration differs; preserve it and review before replacing",
  );
await writeFile(agent, plist, { mode: 0o600 });
let loaded = false;
try {
  await exec("/bin/launchctl", ["print", `gui/${process.getuid()}/${label}`]);
  loaded = true;
} catch {}
if (!loaded)
  await exec("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, agent]);
console.log(
  `Adapter service installed: ${agent}\nHealth: http://127.0.0.1:${environment.MERIDIAN_BRIDGE_PORT || 3006}/health`,
);
