import Database from 'better-sqlite3';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';

// Ensure data directory exists if not an in-memory database
if (env.DB_PATH !== ':memory:') {
  const dir = path.dirname(env.DB_PATH);
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const db = new Database(env.DB_PATH, {
  verbose: env.DEBUG_SQL ? console.log : undefined,
});

db.pragma('journal_mode = WAL');
