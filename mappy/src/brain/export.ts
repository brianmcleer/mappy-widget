/** Quote every cell and neutralize spreadsheet formulas in text exports. */
export function tableCsv (columns: string[], rows: string[][]): string {
  const cell = (value: string): string => {
    let text = String(value ?? '')
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text
    return '"' + text.replace(/"/g, '""') + '"'
  }
  return '\uFEFF' + [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
}
