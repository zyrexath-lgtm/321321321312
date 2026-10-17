import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { analyze, cancelProcessing, fix } from "../lib/document-client";
import type { AnalysisReport, FormattingProfile } from "../document/types";
import { createSampleDocument } from "../sample";
import { issueCount } from "../lib/presentation";
import { createDocxBlob } from "../lib/download";
import {
  loadHistory,
  loadProfile,
  storeHistory,
  storeProfile,
} from "../lib/storage";
import type { HistoryEntry } from "../lib/storage";

type Stage = "empty" | "scanning" | "analysis" | "fixing" | "completed";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

type WorkspaceRefs = {
  toolRef: RefObject<HTMLElement | null>;
  titleRef: RefObject<HTMLHeadingElement | null>;
  uploadButtonRef: RefObject<HTMLButtonElement | null>;
};

/** Owns document lifecycle, cancellation and browser-only metadata. */
export function useDocumentWorkflow({
  toolRef,
  titleRef,
  uploadButtonRef,
}: WorkspaceRefs) {
  const [stage, setStage] = useState<Stage>("empty");
  const [profile, setProfile] = useState<FormattingProfile>(loadProfile);
  const [error, setError] = useState("");
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("all");
  const [progress, setProgress] = useState("Читаем структуру документа");
  const [initialScore, setInitialScore] = useState<number | null>(null);
  const [fixedTotal, setFixedTotal] = useState(0);
  const [initialIssueCount, setInitialIssueCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [downloaded, setDownloaded] = useState(false);
  const [toast, setToast] = useState("");
  const currentBytes = useRef<Uint8Array | null>(null);
  const operation = useRef(0);
  const busy = stage === "scanning" || stage === "fixing";

  useEffect(
    () => () => {
      operation.current++;
      cancelProcessing();
    },
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (stage === "analysis" || stage === "completed")
      titleRef.current?.focus({ preventScroll: true });
  }, [stage]);

  function remember(name: string, nextReport: AnalysisReport) {
    setHistory((previous) => {
      const next = [
        {
          name,
          date: Date.now(),
          score: nextReport.score,
          issues: issueCount(nextReport.issues),
        },
        ...previous.filter((item) => item.name !== name),
      ].slice(0, 5);
      storeHistory(next);
      return next;
    });
  }
  function applyReport(next: AnalysisReport) {
    setReport(next);
    setSelected(
      new Set(
        next.issues.filter((issue) => issue.fixable).map((issue) => issue.id),
      ),
    );
    setCategory("all");
  }
  // Claim the operation before any asynchronous file read or sample generation.
  // Cancellation/replacement must invalidate reads as well as worker responses.
  function beginOperation(name: string, size: number): number {
    const id = ++operation.current;
    cancelProcessing();
    currentBytes.current = null;
    setError("");
    setToast("");
    setFile({ name, size });
    setStage("scanning");
    setProgress("Читаем структуру документа");
    setDownloaded(false);
    setFixedTotal(0);
    setInitialScore(null);
    setInitialIssueCount(0);
    setReport(null);
    setSelected(new Set());
    window.requestAnimationFrame(() =>
      toolRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
    return id;
  }
  async function analyzeBytes(
    bytes: Uint8Array,
    name: string,
    nextProfile: FormattingProfile,
    id: number,
  ) {
    if (operation.current !== id) return;
    currentBytes.current = bytes;
    setFile({ name, size: bytes.byteLength });
    try {
      const next = await analyze(bytes, nextProfile, (message) => {
        if (operation.current === id) setProgress(message);
      });
      if (operation.current !== id) return;
      applyReport(next);
      setInitialScore(next.score);
      setInitialIssueCount(issueCount(next.issues));
      setStage("analysis");
      remember(name, next);
    } catch (cause) {
      if (operation.current !== id) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось прочитать документ. Проверьте файл и попробуйте ещё раз.",
      );
      setStage("empty");
      currentBytes.current = null;
      setFile(null);
    }
  }
  async function receiveFile(upload: File) {
    if (!upload.name.toLowerCase().endsWith(".docx")) {
      setError(
        "Поддерживаются только файлы .docx. Откройте документ в Word и сохраните его в этом формате.",
      );
      return;
    }
    if (upload.size > MAX_FILE_SIZE) {
      setError(
        "Этот файл больше 20 МБ. Уменьшите размер изображений в документе и попробуйте снова.",
      );
      return;
    }
    if (upload.size === 0) {
      setError("Файл пуст. Выберите сохранённый документ .docx.");
      return;
    }
    const id = beginOperation(upload.name, upload.size);
    try {
      const bytes = new Uint8Array(await upload.arrayBuffer());
      if (operation.current !== id) return;
      await analyzeBytes(bytes, upload.name, profile, id);
    } catch {
      if (operation.current !== id) return;
      setError("Браузер не смог открыть файл. Выберите его ещё раз.");
      setStage("empty");
      setFile(null);
      currentBytes.current = null;
    }
  }
  async function sample() {
    const name = "Пример учебной работы.docx";
    const id = beginOperation(name, 0);
    try {
      await analyzeBytes(await createSampleDocument(), name, profile, id);
    } catch {
      if (operation.current !== id) return;
      setError(
        "Не удалось открыть пример. Попробуйте загрузить свой документ.",
      );
      setStage("empty");
      setFile(null);
      currentBytes.current = null;
    }
  }
  function reset() {
    operation.current++;
    cancelProcessing();
    currentBytes.current = null;
    setStage("empty");
    setReport(null);
    setFile(null);
    setError("");
    setSelected(new Set());
    setFixedTotal(0);
    setDownloaded(false);
    setInitialScore(null);
    setInitialIssueCount(0);
    setToast("");
    window.requestAnimationFrame(() => uploadButtonRef.current?.focus());
  }
  async function fixIssues(ids: string[], all: boolean) {
    if (!currentBytes.current || !ids.length || busy) return;
    const id = ++operation.current;
    const previousOccurrences = issueCount(
      report?.issues.filter((issue) => issue.fixable) || [],
    );
    setStage("fixing");
    setProgress("Бережно обновляем оформление");
    setError("");
    try {
      const result = await fix(
        currentBytes.current,
        profile,
        ids,
        (message) => {
          if (operation.current === id) setProgress(message);
        },
      );
      if (operation.current !== id) return;
      currentBytes.current = result.bytes;
      applyReport(result.report);
      setFixedTotal(
        (previous) =>
          previous +
          Math.max(
            0,
            previousOccurrences -
              issueCount(result.report.issues.filter((issue) => issue.fixable)),
          ),
      );
      setDownloaded(false);
      setStage(
        all || !result.report.issues.some((issue) => issue.fixable)
          ? "completed"
          : "analysis",
      );
      if (file) remember(file.name, result.report);
      if (!all)
        setToast(
          `Исправление применено. Проверенные параметры: ${result.report.score}/100.`,
        );
    } catch (cause) {
      if (operation.current !== id) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось применить исправления. Ваш исходный файл в безопасности.",
      );
      setStage("analysis");
    }
  }
  function download() {
    if (!currentBytes.current || !file) return;
    const blob = createDocxBlob(currentBytes.current);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.name.replace(/\.docx$/i, "")}_норма.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setDownloaded(true);
  }
  function applyProfile(next: FormattingProfile) {
    setProfile(next);
    const stored = storeProfile(next);
    if (currentBytes.current && file) {
      const bytes = currentBytes.current;
      const id = beginOperation(file.name, bytes.byteLength);
      void analyzeBytes(bytes, file.name, next, id);
    }
    if (!stored) {
      setToast(
        "Браузер не разрешил сохранить профиль. Настройки действуют до закрытия страницы.",
      );
    }
  }
  function clearHistory() {
    setHistory([]);
    storeHistory([]);
  }
  const visibleIssues =
    report?.issues.filter(
      (issue) => category === "all" || issue.category === category,
    ) || [];
  const fixable = report?.issues.filter((issue) => issue.fixable) || [];
  const selectedIssues = fixable.filter((issue) => selected.has(issue.id));
  const remaining = report ? issueCount(report.issues) : 0;
  const selectedCount = issueCount(selectedIssues);
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isEmpty = stage === "empty";

  return {
    stage,
    profile,
    error,
    file,
    report,
    selected,
    category,
    progress,
    initialScore,
    fixedTotal,
    initialIssueCount,
    history,
    downloaded,
    toast,
    busy,
    isEmpty,
    visibleIssues,
    fixable,
    selectedIssues,
    remaining,
    selectedCount,
    setError,
    setToast,
    setSelected,
    setCategory,
    receiveFile,
    sample,
    reset,
    fixIssues,
    download,
    applyProfile,
    clearHistory,
    toggle,
  };
}

export type DocumentWorkflow = ReturnType<typeof useDocumentWorkflow>;
