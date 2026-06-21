#!/bin/bash
# Installed by tempo-term. Claude Code runs hooks with no controlling terminal,
# so we walk the process ancestry to the claude process (which holds the PTY
# slave) and write an OSC status sequence there. tempo-term's xterm parses it.
# Only acts inside tempo-term, where the shell carries TEMPOTERM=1.
[ -n "$TEMPOTERM" ] || exit 0
p=$PPID
tty=""
for _ in 1 2 3 4 5 6 7 8; do
  { [ -z "$p" ] || [ "$p" = "0" ] || [ "$p" = "1" ]; } && break
  t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')
  # No controlling tty shows as ?? on macOS and ? (or -) on Linux; skip those.
  if [ -n "$t" ] && [ "$t" != "??" ] && [ "$t" != "?" ] && [ "$t" != "-" ]; then
    tty=$t
    break
  fi
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done
[ -n "$tty" ] || exit 0
printf '\033]6973;tempoterm;status;%s\007' "$1" > "/dev/$tty" 2>/dev/null
exit 0
