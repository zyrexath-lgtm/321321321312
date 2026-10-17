import type { RefObject } from "react";
import {
  AlignJustify,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Layers3,
  ListOrdered,
  ScanLine,
  Settings2,
  ShieldCheck,
  Table2,
  Type,
  X,
} from "lucide-react";
import type { Issue } from "../document/types";
import type { DocumentWorkflow } from "../hooks/useDocumentWorkflow";
import { formatBytes, issueCount, numberLabel } from "../lib/presentation";

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

function Score({
  score,
  checked = true,
}: {
  score: number;
  checked?: boolean;
}) {
  return (
    <div
      className="score-ring"
      aria-label={
        checked
          ? `Проверенные параметры: ${score} из 100`
          : "Параметры не проверены"
      }
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="score-track" cx="60" cy="60" r="53" />
        <circle
          className="score-value"
          cx="60"
          cy="60"
          r="53"
          strokeDasharray={`${(checked ? Math.max(0, Math.min(100, score)) : 0) * 3.33} 333`}
        />
      </svg>
      <div>
        <strong>{checked ? score : "—"}</strong>
        <span>{checked ? "ИЗ 100" : "НЕТ ОЦЕНКИ"}</span>
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

/** Report presentation stays separate from the document operation lifecycle. */
export function DocumentReport({
  workflow,
  titleRef,
  onSettings,
}: {
  workflow: DocumentWorkflow;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onSettings: () => void;
}) {
  const {
    stage,
    profile,
    file,
    report,
    selected,
    category,
    initialScore,
    fixedTotal,
    initialIssueCount,
    downloaded,
    error,
    busy,
    visibleIssues,
    fixable,
    selectedIssues,
    remaining,
    selectedCount,
    setError,
    setSelected,
    setCategory,
    fixIssues,
    download,
    toggle,
  } = workflow;
  if (!report) return null;
  const hasChecks = report.checkedRules > 0;
  const coverage = report.coverage;
  const coverageText = coverage
    ? `Проверено ${coverage.checkedChecks} из ${coverage.totalChecks} параметров; абзацев основного текста — ${coverage.checkedParagraphs} из ${coverage.totalParagraphs}.`
    : hasChecks
      ? "Оценка отражает только проверенные параметры основного текста и полей."
      : "Автоматическая оценка недоступна: нет надёжно проверяемых параметров.";
  const categoryChecked = (id: string) =>
    hasChecks &&
    (id === "page" ||
      (["text", "paragraphs"].includes(id) &&
        (coverage?.checkedParagraphs ?? 1) > 0));
  return (
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
                : "Проверка завершена."}
          </h1>
          <p>
            {stage === "completed" ? (
              <>
                Исправлено {fixedTotal} из {initialIssueCount} замечаний.
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
                . Выберите, что исправить, — остальное мы берём на себя.
              </>
            ) : hasChecks ? (
              "В проверенных параметрах отклонений не найдено. Полное соответствие методичке нужно проверить вручную."
            ) : (
              "Нет параметров, которые можно уверенно проверить автоматически. Откройте документ в редакторе для ручной проверки."
            )}
          </p>
          <div className="report-file">
            <FileText size={15} />
            <span title={file?.name}>{file?.name}</span>
            <span>{file && formatBytes(file.size)}</span>
          </div>
        </div>
        <div className="score-summary">
          <Score score={report.score} checked={hasChecks} />
          <div>
            <span className="eyebrow">ПРОВЕРЕННЫЕ ПАРАМЕТРЫ</span>
            <strong>
              {!hasChecks
                ? "Нужна ручная проверка"
                : report.score >= 90
                  ? "Проверенные параметры"
                  : report.score >= 60
                    ? "Наведём порядок"
                    : "Есть над чем поработать"}
            </strong>
            {initialScore !== null && fixedTotal > 0 ? (
              <span className="score-change">
                {initialScore} <ArrowRight size={13} /> {report.score}{" "}
                <span>+{report.score - initialScore}</span>
              </span>
            ) : (
              <span className="score-caption">По проверяемым требованиям</span>
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
          {numberLabel(report.stats.tables, "таблица", "таблицы", "таблиц")}
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
        <button onClick={() => onSettings()}>
          <Settings2 size={14} /> {profile.fontFamily} · {profile.fontSize} пт{" "}
          <ChevronDown size={13} />
        </button>
      </div>
      <p className="coverage-note">
        <CircleHelp size={13} /> {coverageText} Сложные элементы требуют ручной
        проверки. Это не оценка полного соответствия работы требованиям.
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
        <aside className="category-sidebar" aria-label="Категории замечаний">
          <div className="category-caption">
            ДЕТАЛИ ПРОВЕРКИ <span>{CATEGORIES.length}</span>
          </div>
          <button
            className={`category-button ${category === "all" ? "active" : ""}`}
            onClick={() => setCategory("all")}
            aria-pressed={category === "all"}
          >
            <ScanLine size={17} />
            <span>Все замечания</span>
            <b>{remaining}</b>
          </button>
          {CATEGORIES.map(({ id, label, icon: Icon }) => {
            const count = issueCount(
              report.issues.filter((issue) => issue.category === id),
            );
            return (
              <button
                key={id}
                className={`category-button ${category === id ? "active" : ""}`}
                onClick={() => setCategory(id)}
                aria-pressed={category === id}
              >
                <Icon size={17} />
                <span>{label}</span>
                {count ? (
                  <b>{count}</b>
                ) : categoryChecked(id) ? (
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
              Меняем только безопасные параметры оформления. Сложные случаи
              оставляем вам.
            </p>
          </div>
        </aside>
        <div className="issues-area">
          <div className="issues-toolbar">
            <div>
              <h2>
                {category === "all"
                  ? "Всё по пунктам"
                  : CATEGORIES.find((c) => c.id === category)?.label}
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
                    ? hasChecks
                      ? "Проверенные параметры соответствуют профилю. Содержательные требования и методичку стоит проверить отдельно."
                      : "Недостаточно данных для автоматической оценки. Проверьте оформление в редакторе по методичке вуза."
                    : categoryChecked(category)
                      ? "Проверенные параметры этой категории соответствуют профилю."
                      : "Это частичная проверка. Заголовки, нумерацию, подписи и список литературы нужно дополнительно проверить в редакторе по методичке вуза."}
                </p>
              </div>
            )}
          </div>
          {report.warnings.length > 0 && (
            <details className="report-warnings">
              <summary>
                <CircleHelp size={16} /> Что важно знать о проверке{" "}
                <ChevronDown size={15} />
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
            <button className="button secondary" onClick={download}>
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
              <span className="button-count">{selectedCount}</span>
            </button>
          ) : (
            <button className="button secondary" onClick={download}>
              <ArrowDownToLine size={17} /> Скачать DOCX
            </button>
          )}
        </div>
      </div>
    </>
  );
}
