import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface ChatMarkdownProps {
  content: string;
}

/**
 * Renders an assistant reply as Markdown, reusing the note typography
 * (`.note-md`) and lowlight token colours so chat and notes look consistent.
 * Raw HTML in the model output is treated as text (react-markdown's default),
 * which keeps the render safe from injection.
 */
export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return (
    <div className="note-md note-md--chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
