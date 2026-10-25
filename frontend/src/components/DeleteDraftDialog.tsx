import {applicationNumber} from "../application-number";
import { useEffect, useId, useRef } from "react";
import type { Application } from "../types";

export default function DeleteDraftDialog({ application, busy, error, onCancel, onConfirm }: {
  application: Application;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog ref={dialog} className="delete-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <span className="delete-dialog-symbol" aria-hidden="true">!</span>
      <h2 id={titleId}>Удалить черновик?</h2>
      <div id={descriptionId}>
        <p>Заявка № {applicationNumber(application)}</p>
        {application.purpose && <p className="delete-dialog-purpose">{application.purpose}</p>}
        <p>Черновик будет удалён. Восстановить его не получится.</p>
      </div>
      {error && <p className="delete-dialog-error" role="alert">{error}</p>}
      <div className="delete-dialog-actions">
        <button ref={cancel} type="button" className="button secondary" disabled={busy} onClick={onCancel}>Отмена</button>
        <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{busy ? "Удаляем…" : "Удалить"}</button>
      </div>
      {busy && <p className="delete-dialog-progress" role="status">Удаляем черновик…</p>}
    </dialog>
  );
}
