/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 設為 'true' 時於 vite dev 使用 @line/liff-mock（ASM-13）；production build 一律忽略。 */
  readonly VITE_LIFF_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
