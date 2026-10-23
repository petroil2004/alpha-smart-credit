import { useEffect, useRef, useState } from "react";
import { DraftAutosave, prepareSave } from "../autosave";
import type { SaveState } from "../autosave";
import type { Api, Application, DraftFields } from "../types";

const initial: SaveState = { status: "saved", errors: {}, error: null };

export function useDraftAutosave(options: {
  api: Api;
  application: Application | null;
  fields: DraftFields;
  reset: number;
  onSaved: (application: Application) => void;
  onScopeChanged: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const controller = useRef<DraftAutosave | null>(null);
  const [state, setState] = useState<SaveState>(initial);
  const { api, application, fields, reset } = options;
  const id = application?.id;
  const company = application?.company_id;

  useEffect(() => {
    if (!application) { controller.current = null; setState(initial); return; }
    const current = () => latest.current.application?.id === id && latest.current.reset === reset && latest.current.api === api;
    const instance = new DraftAutosave(api, application,
      value => { if (current()) latest.current.onSaved(value); },
      value => { if (current()) setState(value); },
      () => { if (current()) latest.current.onScopeChanged(); },
    );
    controller.current = instance;
    setState(initial);
    instance.update(latest.current.fields);
    return () => { instance.dispose(); if (controller.current === instance) controller.current = null; };
  }, [api, id, company, reset]);

  useEffect(() => { controller.current?.update(fields); }, [fields]);

  const p = application ? prepareSave(fields, application) : { patch: {}, errors: {} };
  const dirty = !!application && (Object.keys(p.patch).length > 0 || Object.keys(p.errors).length > 0);
  const status: SaveState["status"] = state.error ? "error" : state.status === "saving" ? "saving" : dirty ? state.status === "invalid" ? "invalid" : "pending" : "saved";
  return {
    ...state, status, dirty,
    getState: () => controller.current?.state ?? initial,
    flush: () => {
      controller.current?.update(latest.current.fields);
      return controller.current?.flush() ?? Promise.resolve(true);
    },
    retry: () => {
      controller.current?.update(latest.current.fields);
      return controller.current?.retry() ?? Promise.resolve(true);
    },
  };
}
