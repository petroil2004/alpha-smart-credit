import { useId, useState } from "react";

export default function AssistantPreview() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={`assistant-preview ${open ? "is-open" : ""}`}>
      <div className="assistant-invitation">
        <div>
          <strong>Не уверены, что выбрать?</strong>
          <p>Помощник поможет разобраться в вариантах финансирования.</p>
        </div>
        <button
          type="button"
          className="button secondary"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          {open ? "Свернуть помощника" : "Помочь с выбором"}
        </button>
      </div>
      {open && (
        <section id={panelId} className="assistant-panel" aria-label="Помощник по финансированию">
          <h3>Помощник по финансированию</h3>
          <div className="assistant-placeholder">
            <span className="assistant-status">Ассистент пока не подключён</span>
            <p>Здесь можно будет обсудить задачу бизнеса и выбор продукта. Сейчас выберите цель самостоятельно и продолжите оформление.</p>
          </div>
          <label className="field">
            <span>Сообщение помощнику</span>
            <textarea disabled rows={2} placeholder="Ввод станет доступен после подключения ассистента" />
          </label>
          <button type="button" className="button secondary" disabled>Отправить сообщение</button>
        </section>
      )}
    </div>
  );
}
