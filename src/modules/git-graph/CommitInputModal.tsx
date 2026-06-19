import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface InputField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  /** Pre-filled value when the modal opens (e.g. a suggested branch name). */
  defaultValue?: string;
}

interface CommitInputModalProps {
  open: boolean;
  title: string;
  /** Optional descriptive body, e.g. the question for a confirmation dialog. */
  message?: string;
  fields: InputField[];
  confirmLabel: string;
  cancelLabel: string;
  /** Render the confirm button in the danger colour (destructive actions). */
  confirmDanger?: boolean;
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
  message,
  fields,
  confirmLabel,
  cancelLabel,
  confirmDanger = false,
  onConfirm,
  onClose,
}: CommitInputModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // Reset whenever the modal (re)opens or its purpose (title) changes, seeding
  // any fields that carry a default value.
  useEffect(() => {
    if (open) {
      const seeded: Record<string, string> = {};
      for (const field of fields) {
        if (field.defaultValue !== undefined) {
          seeded[field.key] = field.defaultValue;
        }
      }
      setValues(seeded);
    }
    // `fields` is rebuilt each render; key off `title` as the stable open identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {(message || fields.length > 0) && (
        <div className="space-y-3 px-4 py-4">
          {message && <p className="text-[14px] leading-relaxed text-fg-muted">{message}</p>}
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
        )}
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
            className={`rounded px-4 py-1.5 font-mono text-[12px] font-bold text-bg-inset disabled:opacity-50 ${
              confirmDanger ? "bg-danger hover:bg-danger/90" : "bg-accent hover:bg-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
