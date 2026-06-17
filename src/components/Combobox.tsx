import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface ComboboxProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** When true the value can be typed freely (e.g. a custom model name). */
  editable?: boolean;
  placeholder?: string;
  className?: string;
  /** Open the list upward (for triggers near the bottom of the window). */
  dropUp?: boolean;
}

/**
 * A styled replacement for native <select>. The popup list has real padding and
 * hover states, and in editable mode it doubles as a combobox so a user can type
 * a model name that isn't in the suggestions.
 */
export function Combobox({
  value,
  options,
  onChange,
  ariaLabel,
  editable = false,
  placeholder,
  className,
  dropUp = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // In editable mode, narrow the suggestions to what's typed; fall back to the
  // full list when nothing matches so the user can still pick a built-in.
  const matches =
    editable && value
      ? options.filter((o) => o.toLowerCase().includes(value.toLowerCase()))
      : options;
  const list = matches.length > 0 ? matches : options;

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <div className="flex items-center rounded-lg border border-border bg-bg focus-within:border-accent">
        {editable ? (
          <input
            value={value}
            aria-label={ariaLabel}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setOpen(true)}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-subtle"
          />
        ) : (
          <button
            type="button"
            aria-label={ariaLabel}
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center px-3 py-2 text-left text-sm text-fg"
          >
            <span className="truncate">{value}</span>
          </button>
        )}
        <button
          type="button"
          aria-label={ariaLabel}
          tabIndex={-1}
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 px-2 py-2 text-fg-subtle hover:text-fg"
        >
          <ChevronDown
            size={15}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {open && (
        <ul
          className={`absolute left-0 right-0 z-50 max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-border-strong bg-bg-elevated p-1.5 shadow-xl ${
            dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
          }`}
        >
          {list.map((opt) => {
            const active = opt === value;
            return (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                    active ? "bg-bg text-fg" : "text-fg-muted hover:bg-bg hover:text-fg"
                  }`}
                >
                  <span className="truncate">{opt}</span>
                  {active && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
