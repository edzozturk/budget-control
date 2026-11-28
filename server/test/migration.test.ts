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

// Customer numbers moved from accounts to one row per bank and holder.
it('moves customer numbers from accounts to bank customers', () => {
  dir = mkdtempSync(path.join(tmpdir(), 'budget-mig-'));
  const upTo4 = path.join(dir, 'drizzle');
  cpSync(MIGRATIONS, upTo4, { recursive: true });
  const journalPath = path.join(upTo4, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.slice(0, 5);
  writeFileSync(journalPath, JSON.stringify(journal));

  const file = path.join(dir, 'old.db');
  const raw = new Database(file);
  raw.pragma(`cipher='sqlcipher'`);
  raw.pragma('legacy=4');
  raw.pragma(`key='old-password'`);
  migrate(drizzle(raw), { migrationsFolder: upTo4 });
  raw.exec(`
    INSERT INTO workspaces (id, name) VALUES ('w', 'Bütçem');
    INSERT INTO currencies VALUES ('TRY', 'Türk Lirası', '₺', 2);
    INSERT INTO accounts (id, workspace_id, name, type, currency, bank_code, customer_number) VALUES
      ('a', 'w', 'Vadesiz', 'bank', 'TRY', '00062', '12345'),
      ('b', 'w', 'KMH', 'overdraft', 'TRY', '00062', '12345'),
      ('c', 'w', 'Nakit', 'cash', 'TRY', NULL, NULL);
  `);
  raw.close();

  const upgraded = openDatabase(file, 'old-password');
  const rows = upgraded.raw.prepare('SELECT id, bank_code, member_id, customer_number FROM bank_customers').all() as { id: string }[];
  expect(rows).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), bank_code: '00062', member_id: null, customer_number: '12345' }]);
  expect(upgraded.raw.prepare('SELECT count(*) AS n FROM accounts').get()).toEqual({ n: 3 });
  upgraded.close();
});
