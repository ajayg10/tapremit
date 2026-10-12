import { db } from './db';

const migrations = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT UNIQUE,
  wallet_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_address TEXT,
  to_address TEXT,
  amount TEXT NOT NULL,
  token TEXT DEFAULT 'AUSD',
  status TEXT NOT NULL,
  tx_hash TEXT,
  idempotency_key TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  recipient_handle TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  recipient_wallet TEXT,
  amount TEXT NOT NULL,
  display_amount TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'AUSD',
  network TEXT NOT NULL DEFAULT 'Monad Testnet',
  purpose TEXT,
  proposal_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_decision TEXT NOT NULL,
  policy_reasons TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  expires_at DATETIME NOT NULL,
  execution_tx_hash TEXT,
  execution_error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(recipient_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  proposal_hash TEXT,
  details TEXT,
  prev_hash TEXT,
  entry_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_proposals_user_id ON proposals(user_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_proposal_id ON audit_logs(proposal_id);
`;

export const runMigrations = () => {
  try {
    db.exec(migrations);

    // Additive column migrations for existing databases (silently skip if already present)
    const additiveColumns = [
      `ALTER TABLE audit_logs ADD COLUMN prev_hash TEXT`,
      `ALTER TABLE audit_logs ADD COLUMN entry_hash TEXT`,
    ];
    for (const sql of additiveColumns) {
      try { db.exec(sql); } catch { /* column already exists */ }
    }

    // Enforce append-only audit trail at the DB engine level
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
        BEFORE UPDATE ON audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'audit_logs is append-only: updates are not permitted');
        END;

      CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
        BEFORE DELETE ON audit_logs
        BEGIN
          SELECT RAISE(ABORT, 'audit_logs is append-only: deletes are not permitted');
        END;
    `);

    console.log('✅ Migrations applied successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// If run directly
if (require.main === module) {
  runMigrations();
}
