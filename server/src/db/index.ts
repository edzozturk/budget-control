import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// 'better-sqlite3' is aliased to better-sqlite3-multiple-ciphers (SQLCipher support) in package.json.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDatabase {
  db: Db;
  raw: Database.Database;
  close(): void;
}

// Same path from src/db (tsx) and dist/db (compiled): server/drizzle
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
  }
}

function quote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

// The whole file is encrypted with SQLCipher v4 (AES-256, PBKDF2-HMAC-SHA512 key derivation).
// Without the password the file is unreadable, including table names.
function applyKey(raw: Database.Database, password: string) {
  raw.pragma(`cipher='sqlcipher'`);
  raw.pragma('legacy=4');
  raw.pragma(`key=${quote(password)}`);
}

export function databaseExists(dbPath: string) {
  return existsSync(dbPath);
}

export function openDatabase(dbPath: string, password: string, opts: { create?: boolean } = {}): OpenDatabase {
  const exists = existsSync(dbPath);
  if (!exists && !opts.create) throw new Error('Database does not exist');
  if (exists && opts.create) throw new Error('Database already exists');
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const raw = new Database(dbPath);
  try {
    applyKey(raw, password);
    // Any read fails with SQLITE_NOTADB when the key is wrong.
    raw.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (err) {
    raw.close();
    if ((err as { code?: string }).code === 'SQLITE_NOTADB') throw new WrongPasswordError();
    throw err;
  }
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, raw, close: () => raw.close() };
}

export function changePassword(raw: Database.Database, newPassword: string) {
  raw.pragma(`rekey=${quote(newPassword)}`);
}
