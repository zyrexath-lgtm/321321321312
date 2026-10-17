import { analyzeDocument, fixDocument } from "../document/engine";
import type { FormattingProfile } from "../document/types";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

worker.onmessage = (
  event: MessageEvent<{
    operation: "analyze" | "fix";
    bytes: Uint8Array;
    profile: FormattingProfile;
    issueIds: string[];
  }>,
) => {
  try {
    const { operation, bytes, profile, issueIds } = event.data;
    worker.postMessage({
      type: "progress",
      message:
        operation === "fix"
          ? "Бережно применяем выбранные исправления…"
          : "Проверяем структуру и оформление…",
    });
    if (operation === "fix") {
      const result = fixDocument(bytes, profile, issueIds);
      worker.postMessage({ type: "result", result }, [
        result.bytes.buffer as ArrayBuffer,
      ]);
    } else {
      worker.postMessage({
        type: "result",
        result: analyzeDocument(bytes, profile),
      });
    }
  } catch (error) {
    worker.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "Не удалось прочитать документ.",
    });
  }
};
