declare module '*!./local-help-pack.js' {
  const pack: {
    version: number
    widgets: Array<{ folder: string, label: string, docs: Array<import('../brain/types').Doc & { help?: boolean }> }>
    notes: string[]
  }
  export default pack
}
