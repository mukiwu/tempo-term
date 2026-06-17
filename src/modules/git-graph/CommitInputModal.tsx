import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface InputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}

interface CommitInputModalProps {
  open: boolean;
  title: string;
  fields: InputField[];
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

/**
 * A small modal that collects one or more named fields (e.g. a branch or tag
 * name). Rendered through a portal so it overlays the whole app, themed with
 * semantic tokens. Required fields gate the confirm button.
 */
export function CommitInputModal({
  open,
  title,
  fields,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
}: CommitInputModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset whenever the modal (re)opens or its purpose (title) changes.
  useEffect(() => {
    if (open) {
      setValues({});
    }
  }, [open, title]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const requiredFilled = fields.every(
    (field) => !field.required || (values[field.key]?.trim() ?? "") !== "",
  );

  const submit = () => {
    if (!requiredFilled) {
      return;
    }
    onConfirm(values);
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[195] bg-black/60" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[200] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-bg-elevated shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-fg">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-subtle hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          {fields.map((field) => (
            <div key={field.key}>
              <label className="mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-fg-subtle">
                {field.label}
              </label>
              {field.multiline ? (
                <textarea
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  rows={3}
                  className="w-full resize-none rounded border border-border bg-bg-inset px-2.5 py-1.5 font-mono text-[12px] text-fg placeholder-fg-subtle focus:border-accent focus:outline-none"
                />
              ) : (
                <input
                  type="text"
                  autoFocus
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      submit();
                    }
                  }}
                  placeholder={field.placeholder}
                  className="w-full rounded border border-border bg-bg-inset px-2.5 py-1.5 font-mono text-[12px] text-fg placeholder-fg-subtle focus:border-accent focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 font-mono text-[12px] text-fg-subtle hover:text-fg"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!requiredFilled}
            className="rounded bg-accent px-4 py-1.5 font-mono text-[12px] font-bold text-bg-inset hover:bg-accent-hover disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
