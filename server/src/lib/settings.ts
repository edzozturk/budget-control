import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';

// User-editable, per-workspace preferences. New keys get their default until saved.
export const settingsSchema = z.object({
  locale: z.enum(['tr', 'en']),
  baseCurrency: z.string().length(3),
  // Day of month a budget period starts (e.g. 15 when salary arrives on the 15th).
  monthStartDay: z.number().int().min(1).max(28),
  // Budget warning threshold, percent of the limit.
  budgetWarnPercent: z.number().int().min(1).max(100),
  theme: z.enum(['system', 'light', 'dark']),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  locale: 'tr',
  baseCurrency: 'TRY',
  monthStartDay: 1,
  budgetWarnPercent: 80,
  theme: 'system',
};

export function readSettings(db: Db, workspaceId: string): Settings {
  const rows = db.select().from(settings).where(eq(settings.workspaceId, workspaceId)).all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  const parsed = settingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export function writeSettings(db: Db, workspaceId: string, patch: Partial<Settings>) {
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const json = JSON.stringify(value);
      const existing = tx
        .select()
        .from(settings)
        .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)))
        .get();
      if (existing) {
        tx.update(settings)
          .set({ value: json })
          .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key)))
          .run();
      } else {
        tx.insert(settings).values({ workspaceId, key, value: json }).run();
      }
    }
  });
}
