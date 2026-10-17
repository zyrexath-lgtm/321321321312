import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  FileText,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { DocumentInformation } from "./components/DocumentInformation";
import { DocumentReport } from "./components/DocumentReport";
import { DocumentVisual } from "./components/DocumentVisual";
import { ProfileDialog } from "./components/ProfileDialog";
import { useDocumentWorkflow } from "./hooks/useDocumentWorkflow";
import { formatBytes } from "./lib/presentation";
import "./App.css";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const toolRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dragDepth = useRef(0);
  const closeSettings = useRef(() => setShowSettings(false)).current;
  const workflow = useDocumentWorkflow({ toolRef, titleRef, uploadButtonRef });
  const {
    stage,
    profile,
    busy,
    isEmpty,
    error,
    file,
    progress,
    report,
    history,
    toast,
    receiveFile,
    sample,
    reset,
    setError,
    setToast,
    applyProfile,
    clearHistory,
  } = workflow;
  function fileChange(event: ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0];
    setDragOver(false);
    dragDepth.current = 0;
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
                  <DocumentReport
                    workflow={workflow}
                    titleRef={titleRef}
                    onSettings={() => setShowSettings(true)}
                  />
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
        <DocumentInformation
          isEmpty={isEmpty}
          history={history}
          onClearHistory={clearHistory}
        />
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
          onApply={(next) => {
            setShowSettings(false);
            applyProfile(next);
          }}
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
