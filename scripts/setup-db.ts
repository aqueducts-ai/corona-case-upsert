import pg from 'pg';

const { Pool } = pg;

async function setup() {
  console.log('Initializing database schema...');
  console.log('Connecting to:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });

  const client = await pool.connect();
  console.log('Connected to database!');

  try {
    // Core tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS violation_state (
        external_id TEXT PRIMARY KEY,
        activity_id TEXT NOT NULL,
        case_no TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        violation_status TEXT NOT NULL,
        date_observed TEXT,
        site_address TEXT,
        raw_data JSONB,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_violation_state_case_no ON violation_state(case_no);
      CREATE INDEX IF NOT EXISTS idx_violation_state_status ON violation_state(violation_status);

      CREATE TABLE IF NOT EXISTS inspection_state (
        unique_key TEXT PRIMARY KEY,
        case_no TEXT NOT NULL,
        inspection_type TEXT NOT NULL,
        result TEXT NOT NULL,
        scheduled_date TEXT,
        completed_date TEXT,
        inspector TEXT,
        raw_data JSONB,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_inspection_state_case_no ON inspection_state(case_no);
      CREATE INDEX IF NOT EXISTS idx_inspection_state_result ON inspection_state(result);

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
    console.log('Created core tables');

    // Migration: Add LLM matching columns to violation_state
    await client.query(`
      ALTER TABLE violation_state
        ADD COLUMN IF NOT EXISTS matched_ticket_id INTEGER,
        ADD COLUMN IF NOT EXISTS match_method TEXT,
        ADD COLUMN IF NOT EXISTS match_confidence TEXT,
        ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_violation_state_matched_ticket ON violation_state(matched_ticket_id);
    `);
    console.log('Added LLM matching columns');

    // Review queue for manual matching
    await client.query(`
      CREATE TABLE IF NOT EXISTS review_queue (
        id SERIAL PRIMARY KEY,
        external_id TEXT NOT NULL,
        violation_data JSONB NOT NULL,
        candidate_tickets JSONB,
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        resolved_ticket_id INTEGER,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
      CREATE INDEX IF NOT EXISTS idx_review_queue_external_id ON review_queue(external_id);
    `);
    console.log('Created review_queue table');

    // Match log for auditing LLM matching decisions
    await client.query(`
      CREATE TABLE IF NOT EXISTS match_log (
        id SERIAL PRIMARY KEY,
        external_id TEXT NOT NULL,
        match_method TEXT NOT NULL,
        candidate_count INTEGER,
        selected_ticket_id INTEGER,
        confidence TEXT,
        llm_reasoning TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_match_log_external_id ON match_log(external_id);
    `);
    console.log('Created match_log table');

    // Permit state table for tracking permit changes
    await client.query(`
      CREATE TABLE IF NOT EXISTS permit_state (
        permit_no TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        permit_type TEXT,
        permit_subtype TEXT,
        applied_at TEXT,
        approved_at TEXT,
        issued_at TEXT,
        finaled_at TEXT,
        expired_at TEXT,
        site_address TEXT,
        description TEXT,
        notes TEXT,
        job_value NUMERIC,
        apn TEXT,
        raw_data JSONB,
        content_hash TEXT,
        threefold_permit_id INTEGER,
        threefold_type_id INTEGER,
        threefold_subtype_id INTEGER,
        threefold_status_id INTEGER,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_permit_state_status ON permit_state(status);
      CREATE INDEX IF NOT EXISTS idx_permit_state_type ON permit_state(permit_type);
      CREATE INDEX IF NOT EXISTS idx_permit_state_threefold_id ON permit_state(threefold_permit_id);
    `);
    console.log('Created permit_state table');

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
    console.log('Created case_state table');

    console.log('');
    console.log('='.repeat(50));
    console.log('Database setup complete!');
    console.log('='.repeat(50));
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(0);
}

setup().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
