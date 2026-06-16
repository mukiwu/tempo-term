import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";

export function PreviewTabContent({ url }: { url: string }) {
  const { t } = useTranslation("preview");
  const [current, setCurrent] = useState(url);
  const [input, setInput] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="flex h-full flex-col bg-bg">
      <form
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2"
        onSubmit={(e) => {
          e.preventDefault();
          setCurrent(input.trim());
          setReloadKey((k) => k + 1);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("urlPlaceholder")}
          aria-label={t("urlPlaceholder")}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg-inset px-3 py-1 text-xs text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          aria-label={t("reload")}
          title={t("reload")}
          onClick={() => setReloadKey((k) => k + 1)}
          className="rounded p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          <RotateCw size={14} />
        </button>
      </form>
      <iframe
        ref={frameRef}
        key={reloadKey}
        src={current}
        title={t("title")}
        className="min-h-0 flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}
