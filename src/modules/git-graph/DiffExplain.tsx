import { useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { ChatMarkdown } from "@/modules/ai/ChatMarkdown";
import { secretsHasKey } from "@/modules/ai/lib/aiBridge";
import { providerById } from "@/modules/ai/lib/providers";
import { explainDiff } from "./lib/explainDiff";

export interface DiffExplainLabels {
  generate: string;
  explaining: string;
  regenerate: string;
  needKey: string;
  empty: string;
}

interface DiffExplainProps {
  commitHash: string;
  file: string;
  diffText: string;
  providerId: string;
  model: string;
  customBaseUrl: string;
  lang: string;
  labels: DiffExplainLabels;
}

// Session-level cache so switching files/tabs does not re-hit the API. Cleared
// on app restart. Keyed by commit hash + file path.
const explanationCache = new Map<string, string>();

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unexpected error";
}

export function DiffExplain({
  commitHash,
  file,
  diffText,
  providerId,
  model,
  customBaseUrl,
  lang,
  labels,
}: DiffExplainProps) {
  const cacheKey = `${commitHash}|${file}`;
  const [explanation, setExplanation] = useState<string | null>(
    () => explanationCache.get(cacheKey) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (diffText.trim() === "") {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Local providers (Ollama, LM Studio, a keyless custom endpoint) need no
      // key, so only gate on a missing key when the provider actually requires one.
      const provider = providerById(providerId);
      if (provider.needsKey && !(await secretsHasKey(provider.id))) {
        setError(labels.needKey);
        return;
      }
      const text = await explainDiff(diffText, file, providerId, model, lang, customBaseUrl);
      explanationCache.set(cacheKey, text);
      setExplanation(text);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const regenerate = () => {
    explanationCache.delete(cacheKey);
    setExplanation(null);
    void run();
  };

  if (diffText.trim() === "") {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-fg-subtle">
        {labels.empty}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-subtle">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-[13px]">{labels.explaining}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void run()}
          className="rounded border border-border-strong px-2 py-1 text-[13px] text-fg-muted hover:bg-bg-elevated hover:text-fg"
        >
          {labels.regenerate}
        </button>
      </div>
    );
  }

  if (explanation === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <button
          type="button"
          onClick={() => void run()}
          className="flex items-center gap-1.5 rounded border border-border-strong bg-bg-elevated px-3 py-1.5 text-[13px] text-fg hover:bg-bg-inset"
        >
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          {labels.generate}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex justify-end px-2 pt-1.5">
        <button
          type="button"
          onClick={regenerate}
          className="flex items-center gap-1 rounded p-1 text-[13px] text-fg-subtle hover:bg-bg-elevated hover:text-fg"
        >
          <RefreshCw className="h-3 w-3" />
          {labels.regenerate}
        </button>
      </div>
      <div className="px-3 pb-3 text-[13px]">
        <ChatMarkdown content={explanation} />
      </div>
    </div>
  );
}
