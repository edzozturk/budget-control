import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { asc } from 'drizzle-orm';
import type { Config } from '../config.js';
import { changePassword, databaseExists, openDatabase, WrongPasswordError, type OpenDatabase } from '../db/index.js';
import { workspaces } from '../db/schema.js';
import { createWorkspace, seedCurrencies } from '../db/seed.js';
import type { Settings } from './settings.js';

interface Session {
  workspaceId: string;
  lastSeen: number;
}

// Holds the decrypted database while the app is unlocked. Locking (manually or after
// SESSION_IDLE_MINUTES of inactivity) closes the database and forgets every session,
// so the key is only in memory while someone is actively using the app.
export class Vault {
  private open: OpenDatabase | null = null;
  private sessions = new Map<string, Session>();
  private failedAttempts = 0;
  private timer: NodeJS.Timeout;

  constructor(private config: Config) {
    this.timer = setInterval(() => this.expireIdle(), 30_000);
    this.timer.unref();
  }

  get initialized() {
    return databaseExists(this.config.dbPath);
  }

  get unlocked() {
    return this.open !== null;
  }

  get db() {
    if (!this.open) throw new Error('Vault is locked');
    return this.open.db;
  }

  setup(input: { password: string; workspaceName: string } & Pick<Settings, 'locale' | 'baseCurrency'>) {
    if (this.initialized) throw new Error('Already initialized');
    const opened = openDatabase(this.config.dbPath, input.password, { create: true });
    seedCurrencies(opened.db);
    const workspaceId = createWorkspace(opened.db, {
      name: input.workspaceName,
      locale: input.locale,
      baseCurrency: input.baseCurrency,
    });
    this.open = opened;
    return this.newSession(workspaceId);
  }

  async unlock(password: string) {
    // Slow down repeated guesses: 0s, 0s, 0s, then 1s, 2s, 4s... capped at 30s.
    if (this.failedAttempts >= 3) {
      await sleep(Math.min(30_000, 1000 * 2 ** (this.failedAttempts - 3)));
    }
    if (!this.open) {
      try {
        this.open = openDatabase(this.config.dbPath, password);
      } catch (err) {
        if (err instanceof WrongPasswordError) this.failedAttempts++;
        throw err;
      }
    } else {
      // Already unlocked by another browser/device: still verify the password.
      try {
        openDatabase(this.config.dbPath, password).close();
      } catch (err) {
        if (err instanceof WrongPasswordError) this.failedAttempts++;
        throw err;
      }
    }
    this.failedAttempts = 0;
    seedCurrencies(this.open.db);
    const ws = this.open.db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).get();
    if (!ws) throw new Error('No workspace found');
    return this.newSession(ws.id);
  }

  changePassword(current: string, next: string) {
    if (!this.open) throw new Error('Vault is locked');
    openDatabase(this.config.dbPath, current).close();
    changePassword(this.open.raw, next);
  }

  lock() {
    this.sessions.clear();
    this.open?.close();
    this.open = null;
  }

  endSession(token: string) {
    this.sessions.delete(token);
    if (this.sessions.size === 0) this.lock();
  }

  touch(token: string | undefined): Session | null {
    if (!token || !this.open) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.lastSeen > this.idleMs) {
      this.endSession(token);
      return null;
    }
    session.lastSeen = Date.now();
    return session;
  }

  dispose() {
    clearInterval(this.timer);
    this.lock();
  }

  private get idleMs() {
    return this.config.SESSION_IDLE_MINUTES * 60_000;
  }

  private newSession(workspaceId: string) {
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { workspaceId, lastSeen: Date.now() });
    return token;
  }

  private expireIdle() {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (now - s.lastSeen > this.idleMs) this.sessions.delete(token);
    }
    if (this.open && this.sessions.size === 0) this.lock();
  }
}
