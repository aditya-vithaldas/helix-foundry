import { requireSecrets } from "./config.js";
import { store } from "./store.js";
import { startWorker } from "./jobs.js";
requireSecrets();
await store.init();
const stop = startWorker(store);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
