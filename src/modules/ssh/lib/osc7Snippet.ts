/**
 * Copy-pasteable shell setup that makes a remote shell announce its working
 * directory with OSC 7 at every prompt, which lets the file explorer follow
 * `cd` on the remote host (see parseOsc7RemotePath in terminal/lib/osc7.ts).
 */
export const OSC7_SNIPPET = `# bash — add to ~/.bashrc
__osc7_report() { printf '\\033]7;file://%s%s\\033\\\\' "$HOSTNAME" "$PWD"; }
PROMPT_COMMAND="__osc7_report\${PROMPT_COMMAND:+; \$PROMPT_COMMAND}"

# zsh — add to ~/.zshrc
autoload -Uz add-zsh-hook
__osc7_report() { printf '\\033]7;file://%s%s\\033\\\\' "$HOST" "$PWD"; }
add-zsh-hook precmd __osc7_report
`;
