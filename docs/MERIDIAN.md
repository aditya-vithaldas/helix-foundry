# Connect the Meridian cloud database

The optional macOS adapter reads the existing private Google Cloud Storage
bucket with the owner's existing Google Cloud CLI login. It does not deploy a
cloud service, change bucket permissions, or use an OpenAI key.

The adapter checks the generation and SHA-256 of the immutable DuckDB snapshot,
exports every documented table to Parquet with the existing Helix Docker image,
and verifies every table's row count before atomically publishing the export.
It listens only on `127.0.0.1:3006` and supports read-only S3 listing and downloads.
Failed refreshes preserve the last verified export; `/health` reports the error.
No customer production data belongs in this synthetic Meridian connection.

## Start and persist the adapter

Use an existing Node runtime and Google Cloud CLI. Docker Desktop and Helix's
`helix-foundry:local` image must already be available. Keep the repository path
and runtime paths stable because launchd uses their absolute paths.

Set `GCLOUD_BIN`, `CLOUDSDK_CONFIG`, `CLOUDSDK_PYTHON`, and `DOCKER_BIN` to the
existing installations, then run:

```sh
node services/meridian-bridge/install.mjs
curl -fsS http://127.0.0.1:3006/health
```

Installation adds `~/Library/LaunchAgents/local.helix.meridian-bridge.plist`.
It starts at login and checks the cloud snapshot every five minutes. Runtime
data and logs live outside Git in `~/Library/Application Support/Helix Meridian
Bridge`. The adapter retains older exports. If cloud login expires, renew that
existing CLI login; do not put credentials in source files. The CLI login needs
object read access to `meridian-commerce-data-648674198172`.

For foreground operation, set `MERIDIAN_BRIDGE_DATA` to a directory outside the
repository, then run `node services/meridian-bridge/server.mjs`. The port defaults
to 3006; set `MERIDIAN_BRIDGE_PORT` if it is busy. Never stop another service to
free the port. This adapter requires Docker Desktop's `host.docker.internal`.

## Helix setup

Choose **Blob storage**, with these settings:

| Field             | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Endpoint          | `http://host.docker.internal:3006`                                |
| Bucket            | `meridian`                                                        |
| Region            | `us-east-1` (S3 client signing label; data remains in GCP Europe) |
| Prefix            | `tables/`                                                         |
| Access key ID     | `meridian-local`                                                  |
| Secret access key | `meridian-local`                                                  |

The two local placeholder keys are not cloud credentials. The loopback adapter
does not authenticate them or forward them to Google. Click **Test connection**,
select all tables, and import. Helix's existing S3 snapshot refresh follows the
adapter's stable table paths. This imports complete tables, including those
larger than the streamed REST connector's two-million-record limit.

Helix queries imported snapshots locally; each source refreshes independently.
A group of imports that straddles a daily publication can use different source
versions. Inspect adapter health and complete the imports after a publication
if a common version is required. This is a snapshot connection, not live remote
SQL execution or writeback.

Checks: `node --test services/meridian-bridge/test.mjs`. Live validation should
compare adapter table counts and Helix import counts with the cloud manifest.
