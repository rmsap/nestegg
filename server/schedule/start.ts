import "server-only";
import { database, dataDirectory } from "../db/connection";
import { adapters } from "../imports/providers";
import { loadSecretKey } from "../secrets";
import { runDueJobs } from "./jobs.ts";
import type { JobHandler } from "./jobs.ts";
import { syncDueConnections } from "./sync-job.ts";

const TICK = 30_000;
const started = Symbol.for("nestegg.scheduler");

export function startScheduler() {
  const state = globalThis as { [started]?: boolean };
  if (state[started] || process.env.NESTEGG_SCHEDULER === "0") return;
  state[started] = true;
  const key = loadSecretKey(dataDirectory);
  const handlers: Record<string, JobHandler> = {
    "sync-connections": (context) => syncDueConnections(context.db, key, adapters, context).then(() => undefined),
  };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueJobs(database(), handlers);
    } catch (error) {
      console.error("Scheduler tick failed: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      running = false;
    }
  };
  setInterval(tick, TICK).unref();
}
