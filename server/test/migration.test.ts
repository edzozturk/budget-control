import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';

const MIGRATIONS = path.resolve(import.meta.dirname, '../drizzle');
let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A database created by the first release must open with the current code, keeping its data.
it('upgrades a database created by the first release', () => {
  dir = mkdtempSync(path.join(tmpdir(), 'budget-mig-'));
  const firstOnly = path.join(dir, 'drizzle');
  cpSync(MIGRATIONS, firstOnly, { recursive: true });
  const journalPath = path.join(firstOnly, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(journalPath, JSON.stringify(journal));

  const file = path.join(dir, 'old.db');
  const raw = new Database(file);
  raw.pragma(`cipher='sqlcipher'`);
  raw.pragma('legacy=4');
  raw.pragma(`key='old-password'`);
  migrate(drizzle(raw), { migrationsFolder: firstOnly });
  raw.exec(`
    INSERT INTO workspaces (id, name) VALUES ('w', 'Bütçem');
    INSERT INTO currencies VALUES ('TRY', 'Türk Lirası', '₺', 2);
    INSERT INTO accounts (id, workspace_id, name, type, currency) VALUES ('a', 'w', 'Banka', 'bank', 'TRY');
    INSERT INTO transactions (id, workspace_id, kind, date, account_id, amount) VALUES ('t', 'w', 'expense', '2026-01-01', 'a', 100);
  `);
  raw.close();

  const upgraded = openDatabase(file, 'old-password');
  expect(upgraded.raw.prepare('SELECT amount, member_id FROM transactions').get()).toEqual({ amount: 100, member_id: null });
  expect(upgraded.raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'loans'`).get()).toEqual({ name: 'loans' });
  upgraded.close();
});
