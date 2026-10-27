/*
  vendor-shims.d.ts  (Visual Studio only, mode B)

  Widget-specific additions to the shared editor shim. exb-editor-shims.d.ts is the copied
  master and stays untouched; anything Mappy needs beyond it is declared here. Ambient
  module declarations with the same name merge, so this only adds members.
  Keep every type here `any` and import nothing by package name (IDE1100, WIDGETHANDOFF 12.3).
  Webpack ignores .d.ts files.
*/

declare module 'jimu-core' {
    /** Page, view and window navigation (lib/browser-history). */
    export const jimuHistory: any
}
