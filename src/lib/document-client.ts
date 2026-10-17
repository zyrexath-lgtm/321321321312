import type { AnalysisReport, FormattingProfile } from "../document/types";

type FixResult = {
  bytes: Uint8Array;
  report: AnalysisReport;
  fixedCount: number;
};
type Pending = {
  worker: Worker;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
let pending: Pending | undefined;

export function cancelProcessing(): void {
  if (!pending) return;
  const previous = pending;
  pending = undefined;
  clearTimeout(previous.timer);
  previous.worker.terminate();
  previous.reject(new DOMException("Обработка отменена", "AbortError"));
}

function run<T>(
  operation: "analyze" | "fix",
  bytes: Uint8Array,
  profile: FormattingProfile,
  issueIds: string[],
  onProgress?: (message: string) => void,
): Promise<T> {
  cancelProcessing();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/document.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      reject(
        new Error(
          "Не удалось запустить обработку в браузере. Обновите страницу и попробуйте снова.",
        ),
      );
      return;
    }
    const finish = () => {
      if (pending?.worker === worker) {
        clearTimeout(pending.timer);
        pending = undefined;
      }
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          "Документ слишком сложный для обработки в браузере. Попробуйте файл меньшего размера.",
        ),
      );
    }, 60000);
    pending = { worker, reject, timer };
    worker.onmessage = (event) => {
      if (event.data.type === "progress") {
        onProgress?.(event.data.message);
        return;
      }
      finish();
      if (event.data.type === "error") reject(new Error(event.data.message));
      else resolve(event.data.result as T);
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "Не удалось обработать документ. Попробуйте ещё раз или выберите другой DOCX.",
        ),
      );
    };
    worker.onmessageerror = () => {
      finish();
      reject(
        new Error(
          "Не удалось получить результат обработки. Попробуйте ещё раз.",
        ),
      );
    };
    // Transfer a copy: the original is retained for retry, selective fixes and download.
    try {
      const copy = new Uint8Array(bytes);
      worker.postMessage({ operation, bytes: copy, profile, issueIds }, [
        copy.buffer,
      ]);
    } catch {
      // Copy/structured-clone failures otherwise leave an idle worker and timer
      // alive after the caller's promise has already rejected.
      finish();
      reject(
        new Error(
          "Не удалось передать документ на обработку. Попробуйте ещё раз.",
        ),
      );
    }
  });
}

export function analyze(
  bytes: Uint8Array,
  profile: FormattingProfile,
  onProgress?: (message: string) => void,
): Promise<AnalysisReport> {
  return run("analyze", bytes, profile, [], onProgress);
}

export function fix(
  bytes: Uint8Array,
  profile: FormattingProfile,
  issueIds: string[],
  onProgress?: (message: string) => void,
): Promise<FixResult> {
  return run("fix", bytes, profile, issueIds, onProgress);
}
