import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze, cancelProcessing } from "../src/lib/document-client";
import { DEFAULT_PROFILE } from "../src/document/profile";
import { createDocxBlob } from "../src/lib/download";

class FailingWorker {
  static instances: FailingWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor() {
    FailingWorker.instances.push(this);
  }
  postMessage() {
    if (FailingWorker.failPost)
      throw new DOMException("Clone failure", "DataCloneError");
  }
}

afterEach(() => {
  cancelProcessing();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FailingWorker.instances = [];
  FailingWorker.failPost = false;
});

describe("worker failures free resources and permit recovery", () => {
  it("terminates immediately when structured cloning fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FailingWorker);
    FailingWorker.failPost = true;
    await expect(analyze(new Uint8Array([1]), DEFAULT_PROFILE)).rejects.toThrow(
      "передать",
    );
    expect(FailingWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    FailingWorker.failPost = false;
    const retry = analyze(new Uint8Array([1]), DEFAULT_PROFILE);
    const rejected = expect(retry).rejects.toMatchObject({
      name: "AbortError",
    });
    cancelProcessing();
    await rejected;
    expect(FailingWorker.instances[1].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("terminates and rejects an unreadable worker response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FailingWorker);
    const job = analyze(new Uint8Array([1]), DEFAULT_PROFILE);
    const rejected = expect(job).rejects.toThrow("получить результат");
    FailingWorker.instances[0].onmessageerror?.();
    await rejected;
    expect(FailingWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("download snapshot", () => {
  it("copies exactly the selected view once without retaining mutable input", async () => {
    const input = new Uint8Array([99, 1, 2, 3, 88]);
    const blob = createDocxBlob(input.subarray(1, 4));
    input.fill(0);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(blob.size).toBe(3);
  });
});
