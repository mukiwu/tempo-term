import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Editor, Range } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";

export interface SlashItem {
  title: string;
  keywords: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
}

export interface SlashListHandle {
  onKeyDown: (event: KeyboardEvent | globalThis.KeyboardEvent) => boolean;
}

interface SlashCommandListProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  header?: ReactNode;
}

export const SlashCommandList = forwardRef<SlashListHandle, SlashCommandListProps>(
  function SlashCommandList({ items, command, header }, ref) {
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      setSelected(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (event.key === "ArrowDown") {
          setSelected((i) => (items.length ? (i + 1) % items.length : 0));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="max-h-72 w-64 overflow-y-auto rounded-lg border border-border-strong bg-bg-elevated py-1 shadow-xl">
        {header}
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelected(index)}
              onClick={() => command(item)}
              className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                index === selected ? "bg-bg text-fg" : "text-fg-muted"
              }`}
            >
              <Icon size={15} className="shrink-0 text-fg-subtle" />
              {item.title}
            </button>
          );
        })}
      </div>
    );
  },
);
