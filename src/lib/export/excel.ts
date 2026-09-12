import { downloadBlob, safeFilename } from './download'

export interface Sheet {
  name: string
  /** First row is the header. Every row should have the same length. */
  rows: Array<Array<string | number | null>>
}

/**
 * Excel is loaded on demand.
 *
 * SheetJS is ~900 kB. Keeping it out of the initial bundle matters on a phone
 * that only ever enters trips — the library arrives the first time someone
 * actually exports something.
 */
async function loadXlsx() {
  return import('xlsx')
}

function toWorkbook(XLSX: Awaited<ReturnType<typeof loadXlsx>>, sheets: Sheet[]) {
  const workbook = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows)

    // Column widths from the longest cell, so a CA does not have to widen
    // every column before they can read the export.
    const widths = (sheet.rows[0] ?? []).map((_, column) => {
      const longest = sheet.rows.reduce((max, row) => {
        const value = row[column]
        return Math.max(max, value === null || value === undefined ? 0 : String(value).length)
      }, 0)
      return { wch: Math.min(Math.max(longest + 2, 10), 44) }
    })
    worksheet['!cols'] = widths

    // Excel refuses sheet names over 31 characters or containing : \ / ? * [ ]
    const name = sheet.name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  }

  return workbook
}

export async function buildExcelBlob(sheets: Sheet[]): Promise<Blob> {
  const XLSX = await loadXlsx()
  const workbook = toWorkbook(XLSX, sheets)
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function exportExcel(
  sheets: Sheet[],
  filenameParts: Array<string | null | undefined>,
): Promise<void> {
  const blob = await buildExcelBlob(sheets)
  downloadBlob(blob, `${safeFilename(filenameParts)}.xlsx`)
}
