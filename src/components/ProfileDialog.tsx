import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, LockKeyhole, RotateCcw, Settings2, X } from "lucide-react";
import { DEFAULT_PROFILE, validateProfile } from "../document/profile";
import type { FormattingProfile } from "../document/types";

export function ProfileDialog({
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
    // aria-modal describes the dialog; inert also prevents background keyboard,
    // pointer and assistive-technology interaction while it is open.
    const background = Array.from(
      document.querySelector(".app")?.children ?? [],
    ).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        !element.classList.contains("dialog-backdrop"),
    );
    const inertState = background.map(
      (element) => [element, element.inert] as const,
    );
    background.forEach((element) => {
      element.inert = true;
    });
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
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
      inertState.forEach(([element, inert]) => {
        element.inert = inert;
      });
      if (previous?.isConnected) previous.focus();
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
