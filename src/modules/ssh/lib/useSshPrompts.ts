import { useEffect, useReducer } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type PromptKind = "hostKeyUnknown" | "hostKeyChanged" | "password" | "passphrase";

export interface PromptRequest {
  id: string;
  kind: PromptKind;
  message: string;
}

export interface PromptReply {
  approved: boolean;
  secret: string | null;
  remember: boolean;
}

export interface PromptState {
  queue: PromptRequest[];
}

type PromptAction =
  | { type: "incoming"; req: PromptRequest }
  | { type: "answered"; id: string };

export function promptReducer(state: PromptState, action: PromptAction): PromptState {
  switch (action.type) {
    case "incoming":
      return { queue: [...state.queue, action.req] };
    case "answered":
      return { queue: state.queue.filter((r) => r.id !== action.id) };
    default:
      return state;
  }
}

const INITIAL_STATE: PromptState = { queue: [] };

export function useSshPrompts(): {
  current: PromptRequest | undefined;
  reply: (id: string, payload: PromptReply) => void;
} {
  const [state, dispatch] = useReducer(promptReducer, INITIAL_STATE);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<PromptRequest>("ssh-prompt", (event) => {
      dispatch({ type: "incoming", req: event.payload });
    })
      .then((off) => {
        unlisten = off;
      })
      .catch(() => {
        // No Tauri runtime in tests/web preview; swallow silently.
      });

    return () => {
      unlisten?.();
    };
  }, []);

  function reply(id: string, payload: PromptReply): void {
    void invoke("ssh_prompt_reply", { id, reply: payload }).catch(() => {});
    dispatch({ type: "answered", id });
  }

  return {
    current: state.queue[0],
    reply,
  };
}
