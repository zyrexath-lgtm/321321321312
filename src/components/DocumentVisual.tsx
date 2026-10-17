import { Check, CheckCheck, Plus } from "lucide-react";

export function DocumentVisual() {
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
