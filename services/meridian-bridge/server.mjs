import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const exec = promisify(execFile);
const xml = (value) =>
  String(value).replace(
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

export function validateManifest(manifest) {
  if (
    !manifest?.schema?.synthetic ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256 || "") ||
    !/^snapshots\/[\w.-]+\.duckdb$/.test(manifest.object || "") ||
    !/^\d+$/.test(String(manifest.objectGeneration || "")) ||
    !Array.isArray(manifest.schema.tables) ||
    !manifest.schema.tables.length
  )
    throw Error("Invalid synthetic Meridian snapshot manifest");
  const names = new Set();
  for (const table of manifest.schema.tables) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(table.name) ||
      names.has(table.name) ||
      !Number.isSafeInteger(table.rows) ||
      table.rows < 0
    )
      throw Error("Invalid table manifest");
    names.add(table.name);
  }
  const rows = manifest.schema.tables.reduce((n, t) => n + t.rows, 0);
  if (rows !== manifest.schema.totalRows)
    throw Error("Manifest row totals do not match");
  return manifest;
}

export function createBridge({ directory, refresh, initial = null }) {
  let current = initial,
    inFlight,
    lastError = null;
  const update = () =>
    (inFlight ||= (async () => {
      try {
        const next = await refresh(current);
        if (next) current = next;
        lastError = null;
      } catch (error) {
        lastError = error.message;
        console.error(JSON.stringify({ refreshFailed: error.message }));
      } finally {
        inFlight = null;
      }
    })());
  const server = createServer(async (req, res) => {
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    try {
      if (!["GET", "HEAD"].includes(req.method))
        return send(405, { error: "Read-only adapter" });
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health")
        return send(current ? 200 : 503, {
          ok: !!current,
          synthetic: true,
          readOnly: true,
          datasetVersion: current?.version,
          dataThrough: current?.through,
          tables: current?.tables.length,
          rows: current?.rows,
          refreshError: lastError,
        });
      if (!current)
        return send(503, { error: "Initial cloud snapshot is not ready" });
      if (url.pathname === "/meridian" || url.pathname === "/meridian/") {
        if (url.searchParams.get("list-type") !== "2")
          return send(400, { error: "Use S3 ListObjectsV2" });
        const prefix = url.searchParams.get("prefix") || "";
        const tables = current.tables.filter((t) => t.key.startsWith(prefix));
        const body =
          '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
          "<Name>meridian</Name><Prefix>" +
          xml(prefix) +
          "</Prefix><KeyCount>" +
          tables.length +
          "</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>" +
          tables
            .map(
              (t) =>
                "<Contents><Key>" +
                xml(t.key) +
                "</Key><LastModified>" +
                xml(current.exportedAt) +
                '</LastModified><ETag>"' +
                xml(t.sha256) +
                '"</ETag><Size>' +
                t.bytes +
                "</Size><StorageClass>STANDARD</StorageClass></Contents>",
            )
            .join("") +
          "</ListBucketResult>";
        return send(200, body, "application/xml");
      }
      const key = decodeURIComponent(url.pathname.slice("/meridian/".length));
      const table =
        url.pathname.startsWith("/meridian/") &&
        current.tables.find((t) => t.key === key);
      if (!table) return send(404, { error: "Unknown table" });
      const path = resolve(directory, "snapshots", current.sha256, table.key);
      const info = await stat(path);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size,
        ETag: '"' + table.sha256 + '"',
        "Last-Modified": new Date(current.exportedAt).toUTCString(),
        "x-amz-meta-dataset-version": current.version,
        "x-amz-meta-rows": String(table.rows),
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(path)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      if (!res.headersSent) send(500, { error: "Adapter request failed" });
      else res.destroy();
    }
  });
  return { server, update, state: () => current };
}

export function cloudRefresh({
  directory,
  bucket,
  gcloud,
  docker,
  image,
  exporter,
}) {
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(bucket))
    throw Error("Invalid bucket name");
  return async (current) => {
    const { stdout } = await exec(
      gcloud,
      ["storage", "cat", `gs://${bucket}/latest.json`],
      { timeout: 60000, maxBuffer: 2_000_000 },
    );
    const manifest = validateManifest(JSON.parse(stdout));
    if (current?.sha256 === manifest.sha256) return null;
    const stage = resolve(directory, "staging", randomUUID());
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await writeFile(resolve(stage, "manifest.json"), JSON.stringify(manifest), {
      mode: 0o600,
    });
    await exec(
      gcloud,
      [
        "storage",
        "cp",
        `gs://${bucket}/${manifest.object}#${manifest.objectGeneration}`,
        resolve(stage, "input.duckdb"),
      ],
      { timeout: 180000, maxBuffer: 2_000_000 },
    );
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(resolve(stage, "input.duckdb")))
      hash.update(chunk);
    if (hash.digest("hex") !== manifest.sha256)
      throw Error("Cloud snapshot checksum mismatch");
    await exec(
      docker,
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        `${process.getuid()}:${process.getgid()}`,
        "-v",
        `${stage}:/bridge`,
        "-v",
        `${exporter}:/app/meridian-export.mjs:ro`,
        "--entrypoint",
        "node",
        image,
        "/app/meridian-export.mjs",
      ],
      { timeout: 180000, maxBuffer: 2_000_000 },
    );
    const next = JSON.parse(
      await readFile(resolve(stage, "export.json"), "utf8"),
    );
    if (
      next.sha256 !== manifest.sha256 ||
      next.rows !== manifest.schema.totalRows ||
      next.tables.length !== manifest.schema.tables.length
    )
      throw Error("Export does not match source snapshot");
    for (const expected of manifest.schema.tables) {
      const actual = next.tables.find(
        (t) => t.key === `tables/${expected.name}.parquet`,
      );
      if (
        !actual ||
        actual.rows !== expected.rows ||
        !/^[a-f0-9]{64}$/.test(actual.sha256)
      )
        throw Error("Export table verification failed");
    }
    await mkdir(resolve(directory, "snapshots"), { recursive: true });
    const target = resolve(directory, "snapshots", manifest.sha256);
    try {
      await rename(stage, target);
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      const saved = JSON.parse(
        await readFile(resolve(target, "export.json"), "utf8"),
      );
      if (JSON.stringify(saved.tables) !== JSON.stringify(next.tables))
        throw Error("Existing export differs");
    }
    await writeFile(
      resolve(directory, "current.next.json"),
      JSON.stringify(next),
      { mode: 0o600 },
    );
    await rename(
      resolve(directory, "current.next.json"),
      resolve(directory, "current.json"),
    );
    console.log(
      JSON.stringify({
        snapshotReady: next.version,
        tables: next.tables.length,
        rows: next.rows,
      }),
    );
    return next;
  };
}

export async function main() {
  const directory = resolve(
    process.env.MERIDIAN_BRIDGE_DATA ||
      (process.platform === "darwin"
        ? `${homedir()}/Library/Application Support/Helix Meridian Bridge`
        : `${homedir()}/.local/share/helix-meridian-bridge`),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let initial = null;
  try {
    initial = JSON.parse(
      await readFile(resolve(directory, "current.json"), "utf8"),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bridge = createBridge({
    directory,
    initial,
    refresh: cloudRefresh({
      directory,
      bucket:
        process.env.MERIDIAN_BUCKET || "meridian-commerce-data-648674198172",
      gcloud: process.env.GCLOUD_BIN || "gcloud",
      docker: process.env.DOCKER_BIN || "docker",
      image: process.env.MERIDIAN_EXPORT_IMAGE || "helix-foundry:local",
      exporter: resolve(dirname(fileURLToPath(import.meta.url)), "export.mjs"),
    }),
  });
  const port = Number(process.env.MERIDIAN_BRIDGE_PORT || 3006);
  await new Promise((ok, reject) => {
    bridge.server.once("error", reject);
    bridge.server.listen(port, "127.0.0.1", ok);
  });
  console.log(
    JSON.stringify({
      adapterListening: `http://127.0.0.1:${port}`,
      readOnly: true,
    }),
  );
  void bridge.update();
  const timer = setInterval(() => void bridge.update(), 300000);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      clearInterval(timer);
      bridge.server.close(() => process.exit(0));
    });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
