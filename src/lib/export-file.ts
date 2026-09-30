/**
 * Native desktop file export.
 *
 * Uni Kasher is a Tauri application. Keeping the export path native prevents
 * browser-only download behavior from silently diverging from the desktop
 * app and makes backup/CSV exports testable in one place.
 */

export interface ExportResult {
  saved: boolean
  path?: string
}

export async function exportTextFile(
  defaultFileName: string,
  content: string,
  _mimeType: string = 'text/csv;charset=utf-8',
): Promise<ExportResult> {
  const isCsv = defaultFileName.toLowerCase().endsWith('.csv')
  const withBom = isCsv && !content.startsWith('\uFEFF') ? '\uFEFF' + content : content

  const [{ save }, { writeTextFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])

  const ext = defaultFileName.includes('.') ? defaultFileName.split('.').pop()! : 'txt'
  const path = await save({
    defaultPath: defaultFileName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  })

  if (!path) return { saved: false }
  await writeTextFile(path, withBom)
  return { saved: true, path }
}
