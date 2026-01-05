import pg from 'pg';
import { config } from '../config.js';
import { CodeEnforcementCaseRecord, generateCaseHash } from '../parsers/code-enforcement-cases.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Initialize the database schema.
 */
export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    // Sync log for tracking sync operations
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id SERIAL PRIMARY KEY,
        sync_type TEXT NOT NULL,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        total_records INTEGER DEFAULT 0,
        changed_records INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        error_message TEXT,
        metadata JSONB
      );
    `);

    // Code Enforcement Case state table for tracking case changes
    await client.query(`
      CREATE TABLE IF NOT EXISTS case_state (
        case_no TEXT PRIMARY KEY,
        case_opened TEXT,
        case_closed TEXT,
        case_status TEXT NOT NULL,
        case_type TEXT,
        case_subtype TEXT,
        site_address TEXT,
        raw_data JSONB,
        content_hash TEXT,
        threefold_ticket_id INTEGER,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_case_state_status ON case_state(case_status);
      CREATE INDEX IF NOT EXISTS idx_case_state_threefold_id ON case_state(threefold_ticket_id);
    `);

    console.log('Database schema initialized');
  } finally {
    client.release();
  }
}

// ============ Sync Logging ============

export async function createSyncLog(syncType: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO sync_log (sync_type) VALUES ($1) RETURNING id`,
    [syncType]
  );
  return result.rows[0].id;
}

export async function completeSyncLog(
  id: number,
  totalRecords: number,
  changedRecords: number,
  errors: number,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE sync_log SET
      completed_at = NOW(),
      total_records = $2,
      changed_records = $3,
      errors = $4,
      error_message = $5
     WHERE id = $1`,
    [id, totalRecords, changedRecords, errors, errorMessage]
  );
}

// ============ Code Enforcement Case State ============

export interface CaseStateChange {
  caseNo: string;
  record: CodeEnforcementCaseRecord;
  previousHash: string | null;
  newHash: string;
  isNew: boolean;
  previousOpened: string | null;
  previousClosed: string | null;
  previousStatus: string | null;
  threefoldTicketId: number | null;
}

export interface CaseStateRow {
  case_no: string;
  case_opened: string | null;
  case_closed: string | null;
  case_status: string;
  content_hash: string;
  threefold_ticket_id: number | null;
}

/**
 * Determine case status from opened/closed dates.
 * - If has open date AND close date → closed
 * - If has only open date → open
 */
export function determineCaseStatus(caseOpened: string | null, caseClosed: string | null): 'open' | 'closed' {
  if (caseOpened && caseClosed) {
    return 'closed';
  }
  return 'open';
}

/**
 * Compare code enforcement cases against stored state and return changes.
 * Uses content hash to detect any field changes.
 */
export async function diffCases(records: CodeEnforcementCaseRecord[]): Promise<CaseStateChange[]> {
  // Deduplicate by case_no (last occurrence wins)
  const deduped = new Map<string, CodeEnforcementCaseRecord>();
  for (const record of records) {
    deduped.set(record.caseNo, record);
  }
  const uniqueRecords = Array.from(deduped.values());

  const client = await pool.connect();
  try {
    const changes: CaseStateChange[] = [];

    // Get all current states in one query
    const caseNos = uniqueRecords.map(r => r.caseNo);
    const result = await client.query(
      `SELECT case_no, case_opened, case_closed, case_status, content_hash, threefold_ticket_id
       FROM case_state WHERE case_no = ANY($1)`,
      [caseNos]
    );

    const currentStates = new Map<string, CaseStateRow>();
    for (const row of result.rows) {
      currentStates.set(row.case_no, row);
    }

    // Find changes
    for (const record of uniqueRecords) {
      const newHash = generateCaseHash(record);
      const currentState = currentStates.get(record.caseNo);

      if (!currentState) {
        // New record
        changes.push({
          caseNo: record.caseNo,
          record,
          previousHash: null,
          newHash,
          isNew: true,
          previousOpened: null,
          previousClosed: null,
          previousStatus: null,
          threefoldTicketId: null,
        });
      } else if (currentState.content_hash !== newHash) {
        // Content changed (dates changed)
        changes.push({
          caseNo: record.caseNo,
          record,
          previousHash: currentState.content_hash,
          newHash,
          isNew: false,
          previousOpened: currentState.case_opened,
          previousClosed: currentState.case_closed,
          previousStatus: currentState.case_status,
          threefoldTicketId: currentState.threefold_ticket_id,
        });
      }
    }

    return changes;
  } finally {
    client.release();
  }
}

/**
 * Update stored case state.
 * Uses multi-row INSERT for optimal write performance.
 */
export async function upsertCaseState(records: CodeEnforcementCaseRecord[]): Promise<void> {
  if (records.length === 0) return;

  // Deduplicate by case_no (last occurrence wins)
  const deduped = new Map<string, CodeEnforcementCaseRecord>();
  for (const record of records) {
    deduped.set(record.caseNo, record);
  }
  const uniqueRecords = Array.from(deduped.values());

  if (uniqueRecords.length !== records.length) {
    console.log(`[DB] Deduplicated ${records.length} → ${uniqueRecords.length} case records (${records.length - uniqueRecords.length} duplicates)`);
  }

  const BATCH_SIZE = 1000;
  const client = await pool.connect();
  const totalBatches = Math.ceil(uniqueRecords.length / BATCH_SIZE);
  console.log(`[DB] Upserting ${uniqueRecords.length} case records in ${totalBatches} batches...`);

  try {
    for (let i = 0; i < uniqueRecords.length; i += BATCH_SIZE) {
      const batch = uniqueRecords.slice(i, i + BATCH_SIZE);

      // Build multi-row VALUES clause
      const values: unknown[] = [];
      const valuePlaceholders: string[] = [];

      batch.forEach((record, idx) => {
        const offset = idx * 9;
        valuePlaceholders.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, NOW())`
        );
        const status = determineCaseStatus(record.caseOpened, record.caseClosed);
        values.push(
          record.caseNo,
          record.caseOpened,
          record.caseClosed,
          status,
          record.caseType,
          record.caseSubType,
          record.siteAddress,
          JSON.stringify(record.rawData),
          generateCaseHash(record)
        );
      });

      const query = `
        INSERT INTO case_state
          (case_no, case_opened, case_closed, case_status, case_type, case_subtype, site_address, raw_data, content_hash, last_seen_at)
        VALUES ${valuePlaceholders.join(', ')}
        ON CONFLICT (case_no) DO UPDATE SET
          case_opened = EXCLUDED.case_opened,
          case_closed = EXCLUDED.case_closed,
          case_status = EXCLUDED.case_status,
          case_type = EXCLUDED.case_type,
          case_subtype = EXCLUDED.case_subtype,
          site_address = EXCLUDED.site_address,
          raw_data = EXCLUDED.raw_data,
          content_hash = EXCLUDED.content_hash,
          last_seen_at = NOW()
      `;

      await client.query(query, values);
    }

    console.log(`[DB] Upserted ${uniqueRecords.length} case records successfully`);
  } finally {
    client.release();
  }
}

/**
 * Update Threefold ticket ID for a case after successful API sync.
 */
export async function updateCaseThreefoldId(
  caseNo: string,
  threefoldTicketId: number
): Promise<void> {
  await pool.query(
    `UPDATE case_state SET threefold_ticket_id = $2 WHERE case_no = $1`,
    [caseNo, threefoldTicketId]
  );
}

/**
 * Get cached Threefold ticket ID for a case.
 */
export async function getCaseThreefoldId(caseNo: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT threefold_ticket_id FROM case_state WHERE case_no = $1`,
    [caseNo]
  );
  return result.rows[0]?.threefold_ticket_id ?? null;
}
