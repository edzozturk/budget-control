import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Every install-specific value comes from the environment (or a .env file),
// so the same build runs on a laptop, a server or in a container.
const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  DATA_DIR: z.string().default('./data'),
  DB_DRIVER: z.enum(['sqlite']).default('sqlite'),
  DB_FILE: z.string().default('budget.db'),
  APP_NAME: z.string().min(1).default('Budget Control'),
  DEFAULT_LOCALE: z.enum(['tr', 'en']).default('tr'),
  DEFAULT_CURRENCY: z.string().length(3).toUpperCase().default('TRY'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { dbPath: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  return { ...cfg, dbPath: path.resolve(cfg.DATA_DIR, cfg.DB_FILE) };
}

export function loadEnvFile(file = '.env') {
  const candidates = [path.resolve(file), path.resolve('..', file)];
  const found = candidates.find((f) => existsSync(f));
  if (found) process.loadEnvFile(found);
}
