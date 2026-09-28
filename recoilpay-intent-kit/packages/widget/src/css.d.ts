// CSS is bundled as text and injected into the shadow root (tsup `loader`).
declare module '*.css' {
  const css: string;
  export default css;
}
