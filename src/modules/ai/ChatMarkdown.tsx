import { MarkdownView } from "@/components/MarkdownView";

interface ChatMarkdownProps {
  content: string;
}

/**
 * Renders an assistant reply as Markdown, reusing the shared renderer with the
 * chat-bubble spacing variant.
 */
export function ChatMarkdown({ content }: ChatMarkdownProps) {
  return <MarkdownView content={content} className="note-md--chat" />;
}
