import { parse } from 'csv-parse/sync';
import crypto from 'crypto';

/**
 * Parsed Code Enforcement Case record from CSV.
 */
export interface CodeEnforcementCaseRecord {
  caseNo: string;           // CASE_NO (e.g., CE22-1639, CC25-0774)
  caseOpened: string | null; // STARTED date (normalized to YYYY-MM-DD)
  caseClosed: string | null; // CLOSED date (normalized to YYYY-MM-DD)
  caseType: string;         // CaseType (e.g., CODE ENFORCEMENT)
  caseSubType: string;      // CaseSubType (e.g., MULTIPLE VIOLATIONS)
  siteAddress: string;      // Full address from SITE_ADDR, SITE_CITY, SITE_STATE, SITE_ZIP
  rawData: Record<string, string>; // Original CSV row data
}

/**
 * Normalize date from TrakIT format to ISO-8601 date (YYYY-MM-DD).
 * Input: "11/10/2022 12:00:00 AM" or "11/10/2022"
 * Output: "2022-11-10"
 */
function normalizeDate(dateStr: string | undefined | null): string | null {
  if (!dateStr || dateStr.trim() === '') return null;

  // Strip time part if present (e.g., " 12:00:00 AM")
  const datePart = dateStr.split(' ')[0];

  // Parse M/D/YYYY format
  const match = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Build full address from components.
 */
function buildAddress(row: Record<string, string>): string {
  const parts: string[] = [];

  if (row.SITE_ADDR?.trim()) parts.push(row.SITE_ADDR.trim());

  const cityStateZip: string[] = [];
  if (row.SITE_CITY?.trim()) cityStateZip.push(row.SITE_CITY.trim());
  if (row.SITE_STATE?.trim()) cityStateZip.push(row.SITE_STATE.trim());
  if (row.SITE_ZIP?.trim() && row.SITE_ZIP.trim() !== '0') cityStateZip.push(row.SITE_ZIP.trim());

  if (cityStateZip.length > 0) {
    parts.push(cityStateZip.join(', '));
  }

  return parts.join(', ');
}

/**
 * Validate case number format.
 * Expected: ^C[A-Z]\d{2}-\d+$ (e.g., CE22-1639, CC25-0774)
 */
export function isValidCaseNo(caseNo: string): boolean {
  return /^C[A-Z]\d{2}-\d+$/.test(caseNo);
}

/**
 * Generate a content hash for change detection.
 * Includes: caseNo, caseOpened, caseClosed
 */
export function generateCaseHash(record: CodeEnforcementCaseRecord): string {
  const content = [
    record.caseNo,
    record.caseOpened ?? '',
    record.caseClosed ?? '',
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Parse Code Enforcement Cases CSV content.
 *
 * Expected columns:
 * - CASE_NO: Case number (e.g., CE22-1639)
 * - STARTED: Case opened date
 * - CLOSED: Case closed date
 * - CaseType: Type of case
 * - CaseSubType: Subtype of case
 * - SITE_ADDR: Street address
 * - SITE_CITY: City
 * - SITE_STATE: State
 * - SITE_ZIP: ZIP code
 * - Case_Count: Count (usually 1)
 * - Case_Completion: Completion count
 */
export async function parseCodeEnforcementCasesCsv(csvContent: string): Promise<CodeEnforcementCaseRecord[]> {
  // Remove BOM if present
  const cleanContent = csvContent.replace(/^\uFEFF/, '');

  // Remove null bytes that can corrupt CSV parsing
  const sanitized = cleanContent.replace(/\x00/g, '');

  const rows = parse(sanitized, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const records: CodeEnforcementCaseRecord[] = [];
  let skipped = 0;

  for (const row of rows) {
    const caseNo = row.CASE_NO?.trim() || '';

    // Validate case number format
    if (!isValidCaseNo(caseNo)) {
      console.log(`[PARSE] Skipping invalid case number: "${caseNo}"`);
      skipped++;
      continue;
    }

    const record: CodeEnforcementCaseRecord = {
      caseNo,
      caseOpened: normalizeDate(row.STARTED),
      caseClosed: normalizeDate(row.CLOSED),
      caseType: row.CaseType?.trim() || '',
      caseSubType: row.CaseSubType?.trim() || '',
      siteAddress: buildAddress(row),
      rawData: row,
    };

    records.push(record);
  }

  if (skipped > 0) {
    console.log(`[PARSE] Skipped ${skipped} records with invalid case numbers`);
  }

  return records;
}
