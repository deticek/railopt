import { apiRequest, readApiError } from './api-client';
export interface ExcelImportResult {
  imported: {
    routes: number;
    shipments: number;
    parameters: number;
    holidays: number;
    workbookReferenceRows: number;
  };
  databaseTotals: { routes: number; shipments: number; parameters: number; holidays: number };
}
export async function importExcelWorkbook(file: File): Promise<ExcelImportResult> {
  const response = await apiRequest('/imports/excel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
    body: file,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(await readApiError(response, 'Excelove datoteke ni bilo mogoče uvoziti.'));
  return response.json() as Promise<ExcelImportResult>;
}
