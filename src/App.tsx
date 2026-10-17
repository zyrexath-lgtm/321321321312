import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import {
  AlignJustify,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  FileCheck2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  ListOrdered,
  LockKeyhole,
  Plus,
  RotateCcw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Table2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { analyze, cancelProcessing, fix } from "./lib/document-client";
import { DEFAULT_PROFILE, validateProfile } from "./document/profile";
import type {
  AnalysisReport,
  FormattingProfile,
  Issue,
} from "./document/types";
import { createSampleDocument } from "./sample";
import "./App.css";

type Stage = "empty" | "scanning" | "analysis" | "fixing" | "completed";
type HistoryEntry = {
  name: string;
  date: number;
  score: number;
  issues: number;
};
const PROFILE_KEY = "norma.profile.v1";
const HISTORY_KEY = "norma.history.v1";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const CATEGORIES = [
  { id: "page", label: "Страница", icon: FileText },
  { id: "text", label: "Основной текст", icon: Type },
  { id: "paragraphs", label: "Абзацы", icon: AlignJustify },
  { id: "headings", label: "Заголовки", icon: Layers3 },
  { id: "tables", label: "Таблицы", icon: Table2 },
  { id: "images", label: "Изображения и подписи", icon: ImageIcon },
  { id: "numbering", label: "Нумерация", icon: ListOrdered },
  { id: "references", label: "Список литературы", icon: FolderOpen },
] as const;

function loadProfile(): FormattingProfile {
  try {
    const p: unknown = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    if (validateProfile(p)) return p;
  } catch {
    /* Storage may be unavailable. */
  }
  return structuredClone(DEFAULT_PROFILE);
}
function loadHistory(): HistoryEntry[] {
  try {
    const h: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(h))
      return h
        .filter(
          (e) =>
            e &&
            typeof e.name === "string" &&
            typeof e.date === "number" &&
            typeof e.score === "number" &&
            typeof e.issues === "number",
        )
        .slice(0, 5);
  } catch {
    /* Optional metadata only. */
  }
  return [];
}
function issueCount(issues: Issue[]) {
  return issues.reduce((sum, issue) => sum + issue.count, 0);
}
function numberLabel(value: number, one: string, few: string, many: string) {
  const n = value % 100;
  return n > 10 && n < 20
    ? many
    : value % 10 === 1
      ? one
      : value % 10 >= 2 && value % 10 <= 4
        ? few
        : many;
}
function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function ProfileDialog({
  profile,
  onClose,
  onApply,
}: {
  profile: FormattingProfile;
  onClose: () => void;
  onApply: (profile: FormattingProfile) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(profile));
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
        ),
      ];
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  const set = (field: keyof FormattingProfile, value: string | number) =>
    setDraft((p) => ({ ...p, [field]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    if (validateProfile(draft)) onApply(draft);
  }
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        ref={dialogRef}
      >
        <div className="dialog-heading">
          <span className="eyebrow">
            <Settings2 size={14} /> ПРОФИЛЬ ОФОРМЛЕНИЯ
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть настройки"
          >
            <X size={20} />
          </button>
        </div>
        <h2 id="profile-title">Ваши правила.</h2>
        <p className="dialog-description">
          Типовой профиль — хорошая отправная точка. Уточните требования вашей
          кафедры.
        </p>
        <form onSubmit={submit}>
          <div className="form-section">
            <span className="section-number">01</span>
            <h3>Текст и абзацы</h3>
          </div>
          <label className="field full">
            Шрифт
            <select
              value={draft.fontFamily}
              onChange={(e) => set("fontFamily", e.target.value)}
            >
              {[
                "Times New Roman",
                "Arial",
                "Calibri",
                "Cambria",
                "Georgia",
              ].map((font) => (
                <option key={font}>{font}</option>
              ))}
            </select>
          </label>
          <div className="field-grid">
            <label className="field">
              Размер, пт
              <input
                type="number"
                min="8"
                max="36"
                step="0.5"
                value={draft.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value))}
                required
              />
            </label>
            <label className="field">
              Межстрочный интервал
              <input
                type="number"
                min="1"
                max="3"
                step="0.05"
                value={draft.lineSpacing}
                onChange={(e) => set("lineSpacing", Number(e.target.value))}
                required
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field">
              Отступ первой строки, см
              <input
                type="number"
                min="0"
                max="3"
                step="0.05"
                value={draft.firstLineIndent}
                onChange={(e) => set("firstLineIndent", Number(e.target.value))}
                required
              />
            </label>
            <label className="field">
              Выравнивание
              <select
                value={draft.alignment}
                onChange={(e) => set("alignment", e.target.value)}
              >
                <option value="both">По ширине</option>
                <option value="left">По левому краю</option>
                <option value="center">По центру</option>
                <option value="right">По правому краю</option>
              </select>
            </label>
          </div>
          <div className="form-section">
            <span className="section-number">02</span>
            <h3>Поля страницы</h3>
            <span className="unit">СМ</span>
          </div>
          <div className="margins-layout">
            <div className="margin-preview" aria-hidden="true">
              <div>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <i className="margin-mark top" />
              <i className="margin-mark left" />
            </div>
            <div className="field-grid margin-fields">
              {(
                [
                  ["left", "Левое"],
                  ["right", "Правое"],
                  ["top", "Верхнее"],
                  ["bottom", "Нижнее"],
                ] as const
              ).map(([key, label]) => (
                <label className="field" key={key}>
                  {label}
                  <input
                    type="number"
                    min="0.5"
                    max="5"
                    step="0.1"
                    value={draft.margins[key]}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        margins: {
                          ...p.margins,
                          [key]: Number(e.target.value),
                        },
                      }))
                    }
                    required
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="profile-note">
            <LockKeyhole size={16} />
            <span>
              Настройки сохраняются только в этом браузере. Сверьте их с
              методичкой вашего вуза.
            </span>
          </div>
          <div className="dialog-actions">
            <button
              className="text-button"
              type="button"
              onClick={() => setDraft(structuredClone(DEFAULT_PROFILE))}
            >
              <RotateCcw size={15} /> Сбросить
            </button>
            <button
              className="button primary"
              type="submit"
              disabled={!validateProfile(draft)}
            >
              Применить <ArrowRight size={17} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DocumentVisual() {
  return (
    <div className="document-visual" aria-hidden="true">
      <div className="visual-topline">
        <span>ДОКУМЕНТ / ПОД КОНТРОЛЕМ</span>
        <span className="live-dot" />
      </div>
      <div className="document-orbit" />
      <div className="paper-sheet paper-back" />
      <div className="paper-sheet main-paper">
        <div className="paper-meta">
          УЧЕБНАЯ РАБОТА <span>01 / 24</span>
        </div>
        <div className="paper-title">
          Всё на
          <br />
          своём месте.
        </div>
        <div className="paper-rule" />
        <div className="paper-lines">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="paper-section">1.1. Точность в деталях</div>
        <div className="paper-lines shorter">
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="paper-footer">НОРМА — ЭТО ПОРЯДОК.</span>
        <div className="paper-side-mark" />
      </div>
      <div className="visual-tag tag-font">
        <Check size={14} />
        <span>
          Times New Roman <b>14 pt</b>
        </span>
      </div>
      <div className="visual-tag tag-spacing">
        <span className="spacing-icon">↕</span>
        <span>
          Интервал <b>1,5</b>
        </span>
      </div>
      <div className="visual-stamp">
        <CheckCheck size={25} />
        <span>В НОРМЕ</span>
      </div>
      <div className="visual-axis">
        <span>ТОЧНОСТЬ БЕЗ ЛИШНИХ ДЕЙСТВИЙ</span>
        <Plus size={12} />
      </div>
    </div>
  );
}

function Score({
  score,
  compact = false,
}: {
  score: number;
  compact?: boolean;
}) {
  return (
    <div
      className={`score-ring ${compact ? "compact" : ""}`}
      aria-label={`Оценка оформления ${score} из 100`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="score-track" cx="60" cy="60" r="53" />
        <circle
          className="score-value"
          cx="60"
          cy="60"
          r="53"
          strokeDasharray={`${Math.max(0, Math.min(100, score)) * 3.33} 333`}
        />
      </svg>
      <div>
        <strong>{score}</strong>
        <span>ИЗ 100</span>
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  selected,
  busy,
  onToggle,
  onFix,
}: {
  issue: Issue;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onFix: () => void;
}) {
  return (
    <article className={`issue-card ${!issue.fixable ? "manual-issue" : ""}`}>
      <div className="issue-main">
        {issue.fixable ? (
          <label className="issue-checkbox">
            <input
              type="checkbox"
              checked={selected}
              disabled={busy}
              onChange={onToggle}
              aria-label={`Выбрать исправление: ${issue.title}`}
            />
            <span>
              <Check size={13} />
            </span>
          </label>
        ) : (
          <span className="manual-icon">
            <CircleHelp size={18} />
          </span>
        )}
        <div className="issue-copy">
          <div className="issue-title-line">
            <h3>{issue.title}</h3>
            <span className="issue-count">
              {issue.count} {numberLabel(issue.count, "место", "места", "мест")}
            </span>
          </div>
          <p>{issue.description}</p>
        </div>
      </div>
      {(issue.found || issue.expected) && (
        <div className="issue-comparison">
          <div>
            <span>СЕЙЧАС</span>
            <p>{issue.found || "Не определено"}</p>
          </div>
          <ArrowRight size={16} />
          <div>
            <span>ТРЕБУЕТСЯ</span>
            <p>{issue.expected || "Проверьте вручную"}</p>
          </div>
        </div>
      )}
      <div className="issue-bottom">
        {issue.fixable ? (
          <>
            <span>
              <span className="status-dot" /> Безопасное исправление
            </span>
            <button className="issue-fix" onClick={onFix} disabled={busy}>
              Исправить <ArrowUpRight size={15} />
            </button>
          </>
        ) : (
          <>
            <span>Нужна ручная проверка</span>
            <span className="manual-label">Подсказка</span>
          </>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [stage, setStage] = useState<Stage>("empty");
  const [profile, setProfile] = useState<FormattingProfile>(loadProfile);
  const [showSettings, setShowSettings] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const toolRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const currentBytes = useRef<Uint8Array | null>(null);
  const operation = useRef(0);
  const dragDepth = useRef(0);
  const busy = stage === "scanning" || stage === "fixing";
  const closeSettings = useRef(() => setShowSettings(false)).current;

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
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* History is optional. */
      }
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
  async function processBytes(
    bytes: Uint8Array,
    name: string,
    nextProfile = profile,
  ) {
    const id = ++operation.current;
    cancelProcessing();
    setError("");
    setFile({ name, size: bytes.byteLength });
    setStage("scanning");
    setProgress("Читаем структуру документа");
    setDownloaded(false);
    setFixedTotal(0);
    setInitialScore(null);
    setReport(null);
    currentBytes.current = bytes;
    window.requestAnimationFrame(() =>
      toolRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
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
    setDragOver(false);
    dragDepth.current = 0;
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
    try {
      await processBytes(
        new Uint8Array(await upload.arrayBuffer()),
        upload.name,
      );
    } catch {
      setError("Браузер не смог открыть файл. Выберите его ещё раз.");
    }
  }
  function fileChange(event: ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0];
    if (upload) void receiveFile(upload);
    event.target.value = "";
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    dragDepth.current = 0;
    if (busy) return;
    const files = event.dataTransfer.files;
    if (files.length > 1) {
      setError("Проверяем по одному документу. Перетащите один файл .docx.");
      return;
    }
    if (files[0]) void receiveFile(files[0]);
  }
  async function sample() {
    try {
      await processBytes(
        await createSampleDocument(),
        "Пример учебной работы.docx",
      );
    } catch {
      setError(
        "Не удалось открыть пример. Попробуйте загрузить свой документ.",
      );
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
          `Исправление применено. Оформление: ${result.report.score}/100.`,
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
    const blob = new Blob([Uint8Array.from(currentBytes.current).buffer], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
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
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      setToast(
        "Браузер не разрешил сохранить профиль. Настройки действуют до закрытия страницы.",
      );
    }
    setShowSettings(false);
    if (currentBytes.current && file)
      void processBytes(currentBytes.current, file.name, next);
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

  return (
    <div className={`app stage-${stage}`}>
      <a className="skip-link" href="#workspace">
        Перейти к проверке документа
      </a>
      <header className="site-header shell">
        <a
          href="#"
          className="brand"
          title="На главную"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) reset();
          }}
        >
          <span className="brand-symbol" aria-hidden="true">
            н<span />
          </span>
          <span className="brand-name">
            НОРМА<span>ДОКУМЕНТЫ В ПОРЯДКЕ</span>
          </span>
        </a>
        <nav aria-label="Основная навигация">
          <a href="#checks">Что проверяем</a>
          <a href="#privacy">
            Приватность <ArrowUpRight size={12} />
          </a>
        </nav>
        <button
          className="settings-trigger"
          onClick={() => setShowSettings(true)}
          disabled={busy}
        >
          <Settings2 size={17} />
          <span>Настройки оформления</span>
          <span className="settings-short">Настройки</span>
        </button>
      </header>
      <main>
        <section
          className={`workspace shell ${isEmpty ? "empty-workspace" : "active-workspace"}`}
          id="workspace"
          ref={toolRef}
          aria-label="Проверка оформления DOCX"
        >
          {isEmpty ? (
            <>
              <div className="hero-copy">
                <div className="eyebrow hero-eyebrow">
                  <span className="live-dot" /> МЕНЬШЕ ПРАВОК. БЛИЖЕ К СДАЧЕ.
                </div>
                <h1>
                  Работа готова.
                  <br />
                  Остались <em>формальности.</em>
                </h1>
                <p className="hero-description">
                  Курсовая, диплом или реферат — приведите оформление
                  <br className="desktop-break" /> в порядок. За пару кликов,
                  без лишнего стресса.
                </p>
                <div
                  className={`upload-panel ${dragOver ? "drag-over" : ""}`}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    dragDepth.current++;
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    dragDepth.current--;
                    if (dragDepth.current <= 0) setDragOver(false);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={drop}
                >
                  <button
                    className="upload-target"
                    ref={uploadButtonRef}
                    onClick={() => inputRef.current?.click()}
                  >
                    <span className="upload-icon">
                      <Upload size={25} strokeWidth={1.5} />
                      <span className="upload-icon-corner" />
                    </span>
                    <span className="upload-title">
                      {dragOver ? (
                        "Отпускайте. Мы всё проверим."
                      ) : (
                        <>
                          Перетащите работу сюда
                          <span>
                            или{" "}
                            <span className="upload-link">
                              выберите файл <ArrowUpRight size={14} />
                            </span>
                          </span>
                        </>
                      )}
                    </span>
                    <span className="upload-arrow">
                      <ArrowRight size={21} />
                    </span>
                  </button>
                  <div className="upload-bottom">
                    <span>
                      .DOCX <span className="tiny-dot" /> ДО 20 МБ
                    </span>
                    <span>
                      <ShieldCheck size={13} /> ТОЛЬКО НА ВАШЕМ УСТРОЙСТВЕ
                    </span>
                  </div>
                </div>
                {error && (
                  <div className="error-banner" role="alert">
                    <CircleHelp size={19} />
                    <span>{error}</span>
                    <button
                      className="icon-button"
                      aria-label="Скрыть ошибку"
                      onClick={() => setError("")}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                <div className="below-upload">
                  <span>Файл не отправляется на сервер.</span>
                  <button
                    className="sample-button"
                    onClick={() => void sample()}
                  >
                    Попробовать на примере <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              <DocumentVisual />
              <div className="workspace-footnote">
                <span className="bracket-icon">[ ]</span>
                <span>
                  Ваша мысль — главное.
                  <br />
                  <strong>Об оформлении позаботимся мы.</strong>
                </span>
                <span className="footnote-index">
                  01 — 08<span>УРОВНЕЙ ВНИМАНИЯ К ДЕТАЛЯМ</span>
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="tool-topline">
                <span className="eyebrow">
                  <span className="live-dot" /> РАБОЧЕЕ ПРОСТРАНСТВО
                </span>
                <button className="text-button" onClick={reset}>
                  <Plus size={16} />{" "}
                  {busy ? "Отменить проверку" : "Новый документ"}
                </button>
              </div>
              {busy ? (
                <div
                  className="processing-panel"
                  role="status"
                  aria-live="polite"
                >
                  <div className="scan-document">
                    <FileText size={61} strokeWidth={1} />
                    <div className="scan-line" />
                    <span className="scan-corner" />
                  </div>
                  <span className="eyebrow">
                    {stage === "fixing"
                      ? "ПРИВОДИМ В НОРМУ"
                      : "ВНИМАНИЕ К КАЖДОЙ ДЕТАЛИ"}
                  </span>
                  <h1>
                    {stage === "fixing"
                      ? "Порядок уже близко."
                      : "Смотрим на детали."}
                  </h1>
                  <p>{progress}</p>
                  <div className="processing-bar">
                    <span />
                  </div>
                  <div className="processing-file">
                    <FileText size={15} />
                    <span>{file?.name}</span>
                    <span>{file && formatBytes(file.size)}</span>
                  </div>
                  <span className="processing-note">
                    <LockKeyhole size={13} /> Документ остаётся в вашем браузере
                  </span>
                </div>
              ) : (
                report && (
                  <>
                    <div
                      className={`report-summary ${stage === "completed" ? "completed-summary" : ""}`}
                    >
                      <div className="report-intro">
                        <span className="eyebrow">
                          {stage === "completed" ? (
                            <>
                              <CheckCheck size={15} /> ИСПРАВЛЕНИЯ ПРИМЕНЕНЫ
                            </>
                          ) : (
                            "ПРОВЕРКА ЗАВЕРШЕНА"
                          )}
                        </span>
                        <h1 ref={titleRef} tabIndex={-1}>
                          {stage === "completed"
                            ? "Теперь — в норме."
                            : remaining
                              ? "Есть пара формальностей."
                              : "Отличная работа."}
                        </h1>
                        <p>
                          {stage === "completed" ? (
                            <>
                              Исправлено {fixedTotal} из {initialIssueCount}{" "}
                              замечаний.
                              {remaining
                                ? ` Ещё ${remaining} ${numberLabel(remaining, "требует", "требуют", "требуют")} внимания.`
                                : " Проверенные параметры соответствуют профилю."}
                            </>
                          ) : remaining ? (
                            <>
                              Найдено{" "}
                              <strong>
                                {remaining}{" "}
                                {numberLabel(
                                  remaining,
                                  "замечание",
                                  "замечания",
                                  "замечаний",
                                )}
                              </strong>
                              . Выберите, что исправить, — остальное мы берём на
                              себя.
                            </>
                          ) : (
                            "Автоматические проверки не нашли отклонений от вашего профиля."
                          )}
                        </p>
                        <div className="report-file">
                          <FileText size={15} />
                          <span title={file?.name}>{file?.name}</span>
                          <span>{file && formatBytes(file.size)}</span>
                        </div>
                      </div>
                      <div className="score-summary">
                        <Score score={report.score} />
                        <div>
                          <span className="eyebrow">ОФОРМЛЕНИЕ</span>
                          <strong>
                            {report.score >= 90
                              ? "Проверенные параметры"
                              : report.score >= 60
                                ? "Наведём порядок"
                                : "Есть над чем поработать"}
                          </strong>
                          {initialScore !== null && fixedTotal > 0 ? (
                            <span className="score-change">
                              {initialScore} <ArrowRight size={13} />{" "}
                              {report.score}{" "}
                              <span>+{report.score - initialScore}</span>
                            </span>
                          ) : (
                            <span className="score-caption">
                              По автоматическим проверкам
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {error && (
                      <div className="error-banner" role="alert">
                        <CircleHelp size={18} />
                        <span>{error}</span>
                        <button
                          className="icon-button"
                          aria-label="Скрыть ошибку"
                          onClick={() => setError("")}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                    <div className="report-stats">
                      <span>
                        <b>{report.stats.words.toLocaleString("ru-RU")}</b> слов
                      </span>
                      <span>
                        <b>{report.stats.paragraphs}</b> абзацев
                      </span>
                      <span>
                        <b>{report.stats.tables}</b>{" "}
                        {numberLabel(
                          report.stats.tables,
                          "таблица",
                          "таблицы",
                          "таблиц",
                        )}
                      </span>
                      <span>
                        <b>{report.stats.images}</b>{" "}
                        {numberLabel(
                          report.stats.images,
                          "изображение",
                          "изображения",
                          "изображений",
                        )}
                      </span>
                      <button onClick={() => setShowSettings(true)}>
                        <Settings2 size={14} /> {profile.fontFamily} ·{" "}
                        {profile.fontSize} пт <ChevronDown size={13} />
                      </button>
                    </div>
                    <p className="coverage-note">
                      <CircleHelp size={13} /> Оценка отражает основной текст и
                      поля. Сложные элементы требуют ручной проверки.
                    </p>
                    {stage === "completed" && (
                      <div className="completion-banner">
                        <div className="completion-mark">
                          <Check size={24} />
                        </div>
                        <div>
                          <h2>Ваш новый документ готов.</h2>
                          <p>
                            {downloaded
                              ? "Скачивание началось. Сохраните файл в удобном месте."
                              : "Текст и содержимое сохранены. Исходный файл не изменён."}
                          </p>
                        </div>
                        <button className="button primary" onClick={download}>
                          <ArrowDownToLine size={18} /> Скачать DOCX
                        </button>
                      </div>
                    )}
                    <div className="report-body">
                      <aside
                        className="category-sidebar"
                        aria-label="Категории замечаний"
                      >
                        <div className="category-caption">
                          ДЕТАЛИ ПРОВЕРКИ <span>{CATEGORIES.length}</span>
                        </div>
                        <button
                          className={`category-button ${category === "all" ? "active" : ""}`}
                          onClick={() => setCategory("all")}
                        >
                          <ScanLine size={17} />
                          <span>Все замечания</span>
                          <b>{remaining}</b>
                        </button>
                        {CATEGORIES.map(({ id, label, icon: Icon }) => {
                          const count = issueCount(
                            report.issues.filter(
                              (issue) => issue.category === id,
                            ),
                          );
                          return (
                            <button
                              key={id}
                              className={`category-button ${category === id ? "active" : ""}`}
                              onClick={() => setCategory(id)}
                            >
                              <Icon size={17} />
                              <span>{label}</span>
                              {count ? (
                                <b>{count}</b>
                              ) : ["page", "text", "paragraphs"].includes(
                                  id,
                                ) ? (
                                <Check
                                  size={13}
                                  className="category-check"
                                  aria-label="Замечаний не найдено"
                                />
                              ) : (
                                <span
                                  className="category-neutral"
                                  aria-label="Требует ручной проверки"
                                >
                                  —
                                </span>
                              )}
                            </button>
                          );
                        })}
                        <div className="safe-note">
                          <ShieldCheck size={21} />
                          <strong>Сначала — сохранность.</strong>
                          <p>
                            Меняем только безопасные параметры оформления.
                            Сложные случаи оставляем вам.
                          </p>
                        </div>
                      </aside>
                      <div className="issues-area">
                        <div className="issues-toolbar">
                          <div>
                            <h2>
                              {category === "all"
                                ? "Всё по пунктам"
                                : CATEGORIES.find((c) => c.id === category)
                                    ?.label}
                            </h2>
                            <span>
                              {visibleIssues.length
                                ? `${visibleIssues.length} ${numberLabel(visibleIssues.length, "тип замечаний", "типа замечаний", "типов замечаний")}`
                                : "Замечаний нет"}
                            </span>
                          </div>
                          {fixable.length > 0 && (
                            <button
                              className="text-button select-all"
                              onClick={() =>
                                setSelected(
                                  selected.size === fixable.length
                                    ? new Set()
                                    : new Set(fixable.map((issue) => issue.id)),
                                )
                              }
                            >
                              {selected.size === fixable.length
                                ? "Снять выбор"
                                : "Выбрать всё"}
                            </button>
                          )}
                        </div>
                        <div className="issue-list">
                          {visibleIssues.length ? (
                            visibleIssues.map((issue) => (
                              <IssueCard
                                key={issue.id}
                                issue={issue}
                                selected={selected.has(issue.id)}
                                busy={busy}
                                onToggle={() => toggle(issue.id)}
                                onFix={() => void fixIssues([issue.id], false)}
                              />
                            ))
                          ) : (
                            <div className="no-issues">
                              <span>
                                <CheckCheck size={32} strokeWidth={1.4} />
                              </span>
                              <h3>
                                {category === "all"
                                  ? "Автоматических замечаний нет."
                                  : "Замечаний не найдено."}
                              </h3>
                              <p>
                                {category === "all"
                                  ? "Проверенные параметры соответствуют профилю. Содержательные требования и методичку стоит проверить отдельно."
                                  : ["page", "text", "paragraphs"].includes(
                                        category,
                                      )
                                    ? "Проверенные параметры этой категории соответствуют профилю."
                                    : "Это частичная проверка. Заголовки, нумерацию, подписи и список литературы нужно дополнительно проверить в редакторе по методичке вуза."}
                              </p>
                            </div>
                          )}
                        </div>
                        {report.warnings.length > 0 && (
                          <details className="report-warnings">
                            <summary>
                              <CircleHelp size={16} /> Что важно знать о
                              проверке <ChevronDown size={15} />
                            </summary>
                            <ul>
                              {report.warnings.map((warning, index) => (
                                <li key={index}>{warning}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    </div>
                    <div className="report-actionbar">
                      <div>
                        <span className="actionbar-icon">
                          <ShieldCheck size={20} />
                        </span>
                        <div>
                          <strong>
                            {selectedCount
                              ? `Выбрано ${selectedCount} ${numberLabel(selectedCount, "исправление", "исправления", "исправлений")}`
                              : fixable.length
                                ? "Выберите нужные исправления"
                                : "Автоматическая проверка завершена"}
                          </strong>
                          <span>
                            {selectedCount
                              ? "Создадим новый DOCX. Оригинал останется у вас."
                              : "Сверьте оставшиеся детали с методичкой вуза."}
                          </span>
                        </div>
                      </div>
                      <div className="actionbar-buttons">
                        {fixedTotal > 0 && stage !== "completed" && (
                          <button
                            className="button secondary"
                            onClick={download}
                          >
                            <ArrowDownToLine size={17} />
                            <span>Скачать</span>
                          </button>
                        )}
                        {selectedCount > 0 ? (
                          <button
                            className="button primary"
                            onClick={() =>
                              void fixIssues(
                                selectedIssues.map((issue) => issue.id),
                                true,
                              )
                            }
                          >
                            <CheckCheck size={18} />
                            {selected.size === fixable.length
                              ? "Исправить всё"
                              : "Исправить выбранное"}
                            <span className="button-count">
                              {selectedCount}
                            </span>
                          </button>
                        ) : (
                          <button
                            className="button secondary"
                            onClick={download}
                          >
                            <ArrowDownToLine size={17} /> Скачать DOCX
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )
              )}
            </>
          )}
        </section>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="Выбрать файл DOCX"
          disabled={busy}
          onChange={fileChange}
          tabIndex={-1}
        />
        {isEmpty && (
          <section className="trust-strip shell" aria-label="Преимущества">
            <div>
              <LockKeyhole size={18} />
              <span>Ваш документ — только ваш</span>
            </div>
            <div>
              <CheckCheck size={19} />
              <span>Исправляем бережно</span>
            </div>
            <div>
              <Settings2 size={18} />
              <span>Требования под вашим контролем</span>
            </div>
            <span className="trust-tag">
              БЕЗ РЕГИСТРАЦИИ. БЕЗ ЛИШНИХ ДЕЙСТВИЙ.
            </span>
          </section>
        )}
        {isEmpty && history.length > 0 && (
          <section className="history-section shell">
            <div className="history-heading">
              <span className="eyebrow">НЕДАВНО В ЭТОМ БРАУЗЕРЕ</span>
              <button
                className="text-button"
                onClick={() => {
                  setHistory([]);
                  try {
                    localStorage.removeItem(HISTORY_KEY);
                  } catch {
                    /* Optional. */
                  }
                }}
              >
                Очистить историю
              </button>
            </div>
            <div className="history-list">
              {history.slice(0, 3).map((entry, index) => (
                <div className="history-item" key={`${entry.name}-${index}`}>
                  <FileCheck2 size={18} />
                  <span title={entry.name}>
                    {entry.name}
                    <small>
                      {new Date(entry.date).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "long",
                      })}{" "}
                      · файл не хранится
                    </small>
                  </span>
                  <b>
                    {entry.score}
                    <small>/100</small>
                  </b>
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="checks-section shell" id="checks">
          <div className="section-intro">
            <span className="eyebrow">01 / ВНИМАНИЕ К ДЕТАЛЯМ</span>
            <h2>
              Хорошая работа.
              <br />
              <em>Без мелких «но».</em>
            </h2>
            <p>Проверяем то, что легко упустить, когда главное уже написано.</p>
          </div>
          <div className="checks-list">
            <div>
              <span>01</span>
              <h3>Страница и основной текст</h3>
              <p>
                Поля, шрифт, размер, интервал и выравнивание — под ваши
                требования.
              </p>
              <ArrowUpRight size={19} />
            </div>
            <div>
              <span>02</span>
              <h3>Абзацы и структура</h3>
              <p>
                Отступы основного текста и безопасная работа со стилями.
                Заголовки сохраняют свою роль.
              </p>
              <ArrowUpRight size={19} />
            </div>
            <div>
              <span>03</span>
              <h3>Сложные элементы — под защитой</h3>
              <p>
                Таблицы, изображения, формулы и ссылки сохраняем. Неоднозначные
                места предлагаем проверить вручную.
              </p>
              <ShieldCheck size={19} />
            </div>
          </div>
        </section>
        <section className="privacy-section shell" id="privacy">
          <div className="privacy-symbol">
            <LockKeyhole size={31} strokeWidth={1.25} />
          </div>
          <div>
            <span className="eyebrow">02 / ЛИЧНОЕ ОСТАЁТСЯ ЛИЧНЫМ</span>
            <h2>
              Ваш документ не загружается
              <br />
              на наш сервер.
            </h2>
            <p>
              Вся обработка происходит в вашем браузере. Мы не видим текст, не
              храним файлы и не просим аккаунт. Закрыли вкладку — документ исчез
              из памяти.
            </p>
          </div>
          <span className="privacy-label">
            <span className="live-dot" /> LOCAL PROCESSING
          </span>
        </section>
        <section className="faq-section shell" id="about">
          <div>
            <span className="eyebrow">03 / ПОЛЕЗНО ЗНАТЬ</span>
            <h2>Коротко о главном.</h2>
          </div>
          <div className="faq-list">
            <details>
              <summary>
                Это проверка по ГОСТ? <Plus size={17} />
              </summary>
              <p>
                Это типовой профиль оформления учебных работ, а не универсальная
                сертификация по ГОСТ. Требования отличаются у вузов и кафедр.
                Откройте настройки и сверьте параметры с вашей методичкой.
              </p>
            </details>
            <details>
              <summary>
                Может ли измениться текст работы? <Plus size={17} />
              </summary>
              <p>
                Сервис меняет только параметры оформления в DOCX. Текст,
                изображения и другие вложения не переписываются. Оригинал не
                меняется; результат сохраняется отдельным файлом. Перед сдачей
                откройте его в Word и просмотрите сложные страницы.
              </p>
            </details>
            <details>
              <summary>
                Почему некоторые замечания нужно исправить вручную?{" "}
                <Plus size={17} />
              </summary>
              <p>
                Не каждый документ позволяет надёжно определить заголовок,
                подпись или список литературы. Когда автоматическое изменение
                может повредить замыслу, Норма объясняет проблему и оставляет
                решение вам.
              </p>
            </details>
            <details>
              <summary>
                Что делать с PDF или старым файлом .doc? <Plus size={17} />
              </summary>
              <p>
                Откройте исходную работу в Word или LibreOffice и сохраните её в
                формате .docx. PDF не содержит структуру редактируемого
                документа, которая нужна для бережного исправления.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="site-footer shell">
        <a className="footer-brand" href="#workspace">
          НОРМА<span>Хорошей сдачи.</span>
        </a>
        <span>Сделано для тех, кто уже написал главное.</span>
        <a href="#workspace">
          К документу <ArrowUpRight size={15} />
        </a>
      </footer>
      {showSettings && (
        <ProfileDialog
          profile={profile}
          onClose={closeSettings}
          onApply={applyProfile}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            className="icon-button"
            aria-label="Закрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
