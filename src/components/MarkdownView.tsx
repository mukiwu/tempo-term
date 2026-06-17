import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * Shared Markdown renderer (GFM + lowlight highlighting) over the `.note-md`
 * typography, so notes, AI replies and the Markdown file preview look the same.
 * Raw HTML is treated as text (react-markdown's default), keeping it
 * injection-safe.
 */
export function MarkdownView({ content, className }: MarkdownViewProps) {
  return (
    <div className={`note-md ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
