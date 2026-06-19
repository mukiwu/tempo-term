/// <reference types="vite/client" />

declare module "highlight.js/lib/languages/bash" {
  const bash: import("highlight.js").LanguageFn;
  export default bash;
}
