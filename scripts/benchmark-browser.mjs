/** Real-browser benchmark. RSS sums Chromium processes (shared pages counted
 * repeatedly): an upper-bound process-memory proxy, not a JS-heap peak. */
import { chromium } from "@playwright/test";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
const url = process.argv[2] || "http://127.0.0.1:4173";
const output = process.argv[3] || "/tmp/norma-hardening/performance.json";
const runs = Number(process.env.PERF_RUNS || 3);
const manifest = JSON.parse(
  await readFile("/tmp/norma-performance-fixtures/manifest.json", "utf8"),
);
const snapshots = [];
async function treeRss(root) {
  const processes = await Promise.all(
    (await readdir("/proc"))
      .filter((n) => /^\d+$/.test(n))
      .map(async (pid) => {
        try {
          const s = await readFile(`/proc/${pid}/status`, "utf8");
          return {
            pid: Number(pid),
            parent: Number(s.match(/^PPid:\s+(\d+)/m)?.[1]),
            rss: Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024,
          };
        } catch {
          return null;
        }
      }),
  );
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of processes)
      if (p && ids.has(p.parent) && !ids.has(p.pid)) {
        ids.add(p.pid);
        changed = true;
      }
  }
  return processes.reduce((n, p) => n + (p && ids.has(p.pid) ? p.rss : 0), 0);
}
for (const fixture of manifest) {
  for (let repetition = 0; repetition < runs; repetition++) {
    const server = await chromium.launchServer({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const browser = await chromium.connect(server.wsEndpoint());
    let monitoring = false,
      peak = 0,
      idle = 0;
    const samples = [];
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1050 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        const state = (window.__normaPerf = {
          jobs: [],
          phase: "idle",
          gaps: { analyze: [], fix: [] },
        });
        let previous = performance.now();
        setInterval(() => {
          const now = performance.now();
          if (state.gaps[state.phase])
            state.gaps[state.phase].push(now - previous);
          previous = now;
        }, 16);
        document.addEventListener(
          "change",
          (e) => {
            if (
              e.target instanceof HTMLInputElement &&
              e.target.type === "file"
            ) {
              state.phase = "analyze";
              state.userStarted = performance.now();
            }
          },
          true,
        );
        document.addEventListener(
          "click",
          (e) => {
            if (
              e.target instanceof Element &&
              e.target.closest(".report-actionbar .primary")
            ) {
              state.phase = "fix";
              state.userStarted = performance.now();
            }
          },
          true,
        );
        const Original = window.Worker;
        window.Worker = class extends Original {
          constructor(...args) {
            super(...args);
            this.addEventListener("message", (e) => {
              if (e.data?.type === "result" || e.data?.type === "error") {
                state.jobs.push({
                  operation: this.operation,
                  workerRoundTripMs: performance.now() - this.started,
                  userElapsedMs: performance.now() - state.userStarted,
                  error: e.data.type === "error" ? e.data.message : null,
                });
                state.phase = "idle";
              }
            });
          }
          postMessage(message, ...rest) {
            this.operation = message.operation;
            this.started = performance.now();
            return super.postMessage(message, ...rest);
          }
        };
      });
      await page.goto(url);
      await page.locator(".upload-target").waitFor();
      await page.evaluate(() => document.fonts.ready);
      idle = await treeRss(server.process().pid);
      peak = idle;
      monitoring = true;
      const monitor = (async () => {
        while (monitoring) {
          const before = performance.now();
          const rss = await treeRss(server.process().pid);
          peak = Math.max(peak, rss);
          samples.push(rss);
          await new Promise((r) =>
            setTimeout(r, Math.max(0, 40 - (performance.now() - before))),
          );
        }
      })();
      await page.locator("input[type=file]").setInputFiles(fixture.file);
      await page.locator(".report-summary").waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: /Исправить всё/ }).click();
      await page.locator(".completion-banner").waitFor({ timeout: 60000 });
      monitoring = false;
      await monitor;
      const measured = await page.evaluate(() => window.__normaPerf);
      if (errors.length || measured.jobs.some((j) => j.error))
        throw new Error(JSON.stringify({ errors, jobs: measured.jobs }));
      const item = {
        targetMiB: fixture.targetMiB,
        bytes: fixture.bytes,
        repetition: repetition + 1,
        jobs: measured.jobs,
        mainThreadMaxGapMs: Object.fromEntries(
          Object.entries(measured.gaps).map(([k, v]) => [
            k,
            v.length ? Math.max(...v) : null,
          ]),
        ),
        rssIdleMiB: idle / 1048576,
        rssPeakMiB: peak / 1048576,
        rssIncreaseMiB: (peak - idle) / 1048576,
        rssSamples: samples.length,
      };
      snapshots.push(item);
      console.log(JSON.stringify(item));
    } finally {
      monitoring = false;
      await browser.close();
      await server.close();
    }
  }
}
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    {
      url,
      date: new Date().toISOString(),
      node: process.version,
      runs,
      method:
        "1000 paragraphs + valid incompressible PNG; worker round-trip and input/click-to-result; 16ms UI heartbeat; 40ms Linux Chromium process-tree RSS proxy; fresh browser per run",
      results: snapshots,
    },
    null,
    2,
  ),
);
