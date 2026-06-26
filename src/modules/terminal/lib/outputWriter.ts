/** A chunk xterm's `term.write` accepts. Both forms expose `.length`. */
export type WriteChunk = string | Uint8Array;

export interface OutputWriterOptions {
  /** Sink for batched output (typically `term.write`). */
  write: (chunk: WriteChunk) => void;
  /** Schedule a flush on the next frame. Injectable for tests. */
  schedule?: (cb: () => void) => number;
  /** Cancel a scheduled flush. */
  cancel?: (handle: number) => void;
  /** Max bytes written to the sink per frame; the rest waits for the next frame. */
  maxBytesPerFlush?: number;
  /** Max bytes allowed to sit in the queue; older bytes are dropped past this. */
  backlogCap?: number;
  /** Called after output is dropped under overload, with the running dropped total. */
  onDrop?: (droppedBytes: number) => void;
}

/** nyaterm's writeChunkChars: a comfortable per-frame write budget. */
const DEFAULT_MAX_BYTES_PER_FLUSH = 32 * 1024;
/** nyaterm's visibleBacklogCap: how much unwritten output we keep before dropping. */
const DEFAULT_BACKLOG_CAP = 1_000_000;

export interface TerminalOutputWriter {
  /** Queue a chunk to be written on the next flush. */
  push(chunk: WriteChunk): void;
  /** Cancel any pending flush; no further writes happen. */
  dispose(): void;
  /** Total bytes dropped from the queue under overload. */
  readonly droppedBytes: number;
}

/**
 * Batches terminal output and flushes it on animation frames instead of writing
 * synchronously on every PTY/SSH data event, so a flood of output can't block
 * the UI thread.
 */
export function createOutputWriter(options: OutputWriterOptions): TerminalOutputWriter {
  const schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
  const maxBytesPerFlush = options.maxBytesPerFlush ?? DEFAULT_MAX_BYTES_PER_FLUSH;
  const backlogCap = options.backlogCap ?? DEFAULT_BACKLOG_CAP;
  const cancel = options.cancel ?? ((h) => cancelAnimationFrame(h));
  const queue: WriteChunk[] = [];
  let queuedBytes = 0;
  let droppedBytes = 0;
  let handle: number | null = null;
  let disposed = false;

  // Keep the queue under the cap by dropping the oldest chunks. Always keep the
  // most recent chunk so the newest output survives even a single huge write.
  function trim(): void {
    const before = droppedBytes;
    while (queue.length > 1 && queuedBytes > backlogCap) {
      const dropped = queue.shift() as WriteChunk;
      queuedBytes -= dropped.length;
      droppedBytes += dropped.length;
    }
    if (droppedBytes > before) {
      options.onDrop?.(droppedBytes);
    }
  }

  function flush(): void {
    handle = null;
    if (disposed) {
      return;
    }
    let written = 0;
    // Always write at least one chunk so a single oversized chunk can't stall
    // forever; otherwise stop once the next chunk would blow the frame budget.
    while (queue.length > 0) {
      if (written > 0 && written + queue[0].length > maxBytesPerFlush) {
        break;
      }
      const chunk = queue.shift() as WriteChunk;
      queuedBytes -= chunk.length;
      options.write(chunk);
      written += chunk.length;
    }
    if (queue.length > 0) {
      handle = schedule(flush);
    }
  }

  return {
    push(chunk) {
      if (disposed) {
        return;
      }
      queue.push(chunk);
      queuedBytes += chunk.length;
      trim();
      if (handle === null) {
        handle = schedule(flush);
      }
    },
    dispose() {
      disposed = true;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
    get droppedBytes() {
      return droppedBytes;
    },
  };
}
