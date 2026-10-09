# Use a smaller Meridian snapshot

For a shorter first build, export the latest month from an already verified
synthetic Meridian snapshot. This keeps the original DuckDB snapshot and its
full Parquet exports intact. Choose a new output folder outside the repository:

```sh
node services/meridian-bridge/export-window.mjs \
  '/path/to/bridge/snapshots/SNAPSHOT_SHA' \
  '/path/outside/repository/meridian-last-month'
```

The window ends on the snapshot's last complete date. Orders and sessions use
that date window. Order items, payments and shipments follow the selected
orders. Customers, products, regions and categories retain the referenced
entities, including customers whose signup date predates the window. Calendar
and market observations use the window; business events include overlapping
events. Generation history uses its generation date.

The exporter verifies the original checksum, nine foreign-key relationships
and every exported row count. It refuses to overwrite an existing output
directory. Upload the 13 exported Parquet files into a separate workspace.
Review and confirm its ontology before building. The original full workspace
remains available separately.

The reduction is not exactly 1/12: referenced dimensions and seasonal volume
affect the result. The 9 September–8 October 2026 snapshot contains 978,259 rows
versus 10,242,622 in the full snapshot. Snapshot files and generated metadata
belong outside Git.

Increasing Docker Desktop memory requires restarting its VM. A running
publication currently restarts record and relationship creation from the
beginning; preserved imported snapshots do not need to be downloaded again.
