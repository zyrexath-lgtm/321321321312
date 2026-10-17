import {
  ArrowUpRight,
  CheckCheck,
  FileCheck2,
  LockKeyhole,
  Plus,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import type { HistoryEntry } from "../lib/storage";

export function DocumentInformation({
  isEmpty,
  history,
  onClearHistory,
}: {
  isEmpty: boolean;
  history: HistoryEntry[];
  onClearHistory: () => void;
}) {
  return (
    <>
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
            <button className="text-button" onClick={onClearHistory}>
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
              Отступы основного текста и безопасная работа со стилями. Заголовки
              сохраняют свою роль.
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
              Не каждый документ позволяет надёжно определить заголовок, подпись
              или список литературы. Когда автоматическое изменение может
              повредить замыслу, Норма объясняет проблему и оставляет решение
              вам.
            </p>
          </details>
          <details>
            <summary>
              Что делать с PDF или старым файлом .doc? <Plus size={17} />
            </summary>
            <p>
              Откройте исходную работу в Word или LibreOffice и сохраните её в
              формате .docx. PDF не содержит структуру редактируемого документа,
              которая нужна для бережного исправления.
            </p>
          </details>
        </div>
      </section>
    </>
  );
}
