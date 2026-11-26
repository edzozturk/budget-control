import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { accounts, categories, categoryRules, currencies, importLines, imports, transactions } from '../db/schema.js';
import { addDays } from '../lib/dates.js';
import { HttpError, idParam, isoDate, notFound } from '../lib/http.js';
import {
  type Cell,
  foldText,
  guessMapping,
  lineKey,
  type Mapping,
  mappingSchema,
  parseStatementFile,
  readLines,
  StatementError,
} from '../lib/statement.js';
import { getAccount } from './accounts.js';
import { getCategory } from './categories.js';
import { getMember } from './members.js';

const MAX_ROWS = 20000;
const BODY_LIMIT = 25 * 1024 * 1024;
const cell = z.union([z.string(), z.number(), z.null()]);
const rowsSchema = z.array(z.array(cell)).max(MAX_ROWS);

const previewInput = z.object({ accountId: z.string().uuid(), rows: rowsSchema, mapping: mappingSchema });

const optionalId = z.string().uuid().nullish();
const commitInput = z.object({
  accountId: z.string().uuid(),
  fileName: z.string().max(255).default(''),
  mapping: mappingSchema,
  lines: z
    .array(
      z.object({
        key: z.string().max(500),
        date: isoDate,
        description: z.string().max(1000),
        amount: z.number().int(),
        include: z.boolean(),
        categoryId: optionalId,
        memberId: optionalId,
        transferAccountId: optionalId,
        matchedTransactionId: optionalId,
      }),
    )
    .max(MAX_ROWS),
});

const ruleInput = z.object({
  pattern: z.string().trim().min(2).max(200),
  categoryId: optionalId,
  memberId: optionalId,
  transferAccountId: optionalId,
});

type Rule = typeof categoryRules.$inferSelect;

function decimalsFor(db: Db, currency: string) {
  return db.select().from(currencies).where(eq(currencies.code, currency)).get()?.decimals ?? 2;
}

// The longest matching pattern wins, so "MIGROS SANAL" beats "MIGROS".
export function matchRule(rules: Rule[], description: string) {
  const text = foldText(description);
  return rules
    .filter((r) => text.includes(foldText(r.pattern)))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
}

function savedMapping(raw: string | null): Mapping | null {
  if (!raw) return null;
  const parsed = mappingSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function importRoutes(app: FastifyInstance) {
  const { vault } = app;

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body, done) => done(null, body));

  // Reads a statement file into a grid and proposes a column mapping (the account's saved one if it still fits).
  app.post('/imports/parse', { bodyLimit: BODY_LIMIT }, async (req) => {
    const { accountId } = z.object({ accountId: z.string().uuid() }).parse(req.query);
    const account = getAccount(vault.db, req.workspaceId, accountId);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'file_required');
    let rows: Cell[][];
    try {
      rows = await parseStatementFile(req.body);
    } catch (err) {
      if (err instanceof StatementError) throw new HttpError(400, err.code);
      throw new HttpError(400, 'unreadable_file');
    }
    if (rows.length > MAX_ROWS) throw new HttpError(400, 'too_many_rows');
    const saved = savedMapping(account.importMapping);
    const decimals = decimalsFor(vault.db, account.currency);
    const mapping = saved && readLines(rows, saved, decimals).length > 0 ? saved : guessMapping(rows, account.type === 'credit_card');
    return { rows, mapping, savedMapping: mapping === saved };
  });

  // Normalises the lines and says, for each, whether it is new, already imported, or matches a
  // transaction entered by hand; new lines get a suggested category from the rules.
  app.post('/imports/preview', { bodyLimit: BODY_LIMIT }, async (req) => {
    const { accountId, rows, mapping } = previewInput.parse(req.body);
    const account = getAccount(vault.db, req.workspaceId, accountId);
    const lines = readLines(rows, mapping, decimalsFor(vault.db, account.currency));
    if (lines.length === 0) return { lines: [], fromDate: null, toDate: null };

    const occurrences = new Map<string, number>();
    const keyed = lines.map((l) => {
      const base = lineKey(l, 0);
      const n = occurrences.get(base) ?? 0;
      occurrences.set(base, n + 1);
      return { ...l, key: lineKey(l, n) };
    });

    const seen = new Set(
      vault.db
        .select({ key: importLines.key })
        .from(importLines)
        .where(eq(importLines.accountId, accountId))
        .all()
        .map((r) => r.key),
    );
    const linked = new Set(
      vault.db
        .select({ id: importLines.transactionId })
        .from(importLines)
        .where(and(eq(importLines.accountId, accountId), isNotNull(importLines.transactionId)))
        .all()
        .map((r) => r.id),
    );

    const dates = keyed.map((l) => l.date).sort();
    const fromDate = dates[0];
    const toDate = dates.at(-1)!;
    // Transactions entered by hand (or by paying a loan or card in the app) that a line may be.
    const candidates = vault.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, req.workspaceId),
          or(eq(transactions.accountId, accountId), eq(transactions.toAccountId, accountId)),
          gte(transactions.date, addDays(fromDate, -3)),
          lte(transactions.date, addDays(toDate, 3)),
        ),
      )
      .all()
      .filter((t) => !linked.has(t.id));
    const used = new Set<string>();
    const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

    const rules = vault.db.select().from(categoryRules).where(eq(categoryRules.workspaceId, req.workspaceId)).all();
    const cats = new Map(
      vault.db
        .select()
        .from(categories)
        .where(eq(categories.workspaceId, req.workspaceId))
        .all()
        .map((c) => [c.id, c]),
    );
    // Lines whose description was categorised before on this account reuse that category.
    const history = new Map<string, string>();
    for (const t of vault.db
      .select({ note: transactions.note, categoryId: transactions.categoryId, kind: transactions.kind })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), isNotNull(transactions.categoryId)))
      .orderBy(desc(transactions.date))
      .all()) {
      const k = `${t.kind}|${foldText(t.note)}`;
      if (!history.has(k)) history.set(k, t.categoryId!);
    }

    const result = keyed.map((l) => {
      const base = { ...l, status: 'new' as 'new' | 'duplicate' | 'matched', matchedTransactionId: null as string | null };
      const kind = l.amount < 0 ? 'expense' : 'income';
      if (seen.has(l.key)) return { ...base, status: 'duplicate' as const, categoryId: null, memberId: null, transferAccountId: null, ruleId: null };

      const abs = Math.abs(l.amount);
      const match = candidates
        .filter((t) => !used.has(t.id) && dayGap(t.date, l.date) <= 3)
        .filter((t) =>
          l.amount < 0
            ? t.accountId === accountId && t.kind !== 'income' && t.amount === abs
            : (t.accountId === accountId && t.kind === 'income' && t.amount === abs) ||
              (t.toAccountId === accountId && t.kind === 'transfer' && t.toAmount === abs),
        )
        .sort((a, b) => dayGap(a.date, l.date) - dayGap(b.date, l.date))[0];
      if (match) {
        used.add(match.id);
        return { ...base, status: 'matched' as const, matchedTransactionId: match.id, categoryId: match.categoryId, memberId: match.memberId, transferAccountId: null, ruleId: null };
      }

      const rule = matchRule(rules, l.description);
      const ruleCategory = rule?.categoryId ? cats.get(rule.categoryId) : undefined;
      const transferAccountId = rule?.transferAccountId && rule.transferAccountId !== accountId ? rule.transferAccountId : null;
      const categoryId = transferAccountId
        ? null
        : ruleCategory?.kind === kind
          ? ruleCategory.id
          : (history.get(`${kind}|${foldText(l.description)}`) ?? null);
      return { ...base, categoryId, memberId: rule?.memberId ?? null, transferAccountId, ruleId: rule?.id ?? null };
    });
    return { lines: result, fromDate, toDate };
  });

  app.post('/imports', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const body = commitInput.parse(req.body);
    const account = getAccount(vault.db, req.workspaceId, body.accountId);
    const included = body.lines.filter((l) => l.include);
    for (const l of included) {
      if (l.categoryId) getCategory(vault.db, req.workspaceId, l.categoryId);
      if (l.memberId) getMember(vault.db, req.workspaceId, l.memberId);
      if (l.transferAccountId) {
        const other = getAccount(vault.db, req.workspaceId, l.transferAccountId);
        if (other.id === account.id) throw new HttpError(400, 'transfer_same_account');
        if (other.currency !== account.currency) throw new HttpError(400, 'transfer_currency_mismatch');
      }
      if (l.matchedTransactionId) {
        const t = vault.db.select().from(transactions).where(eq(transactions.id, l.matchedTransactionId)).get();
        if (!t || t.workspaceId !== req.workspaceId) throw notFound('Transaction');
      }
    }
    const seen = new Set(
      vault.db
        .select({ key: importLines.key })
        .from(importLines)
        .where(eq(importLines.accountId, account.id))
        .all()
        .map((r) => r.key),
    );
    const fresh = included.filter((l) => !seen.has(l.key));
    const dates = fresh.map((l) => l.date).sort();
    const id = randomUUID();

    const result = vault.db.transaction((tx) => {
      tx.insert(imports)
        .values({
          id,
          workspaceId: req.workspaceId,
          accountId: account.id,
          fileName: body.fileName,
          fromDate: dates[0] ?? null,
          toDate: dates.at(-1) ?? null,
          createdCount: fresh.filter((l) => !l.matchedTransactionId).length,
          matchedCount: fresh.filter((l) => l.matchedTransactionId).length,
        })
        .run();
      for (const l of fresh) {
        let transactionId = l.matchedTransactionId ?? null;
        if (!transactionId) {
          transactionId = randomUUID();
          const abs = Math.abs(l.amount);
          const out = l.amount < 0;
          const values = l.transferAccountId
            ? {
                kind: 'transfer' as const,
                accountId: out ? account.id : l.transferAccountId,
                toAccountId: out ? l.transferAccountId : account.id,
                toAmount: abs,
                categoryId: null,
              }
            : { kind: out ? ('expense' as const) : ('income' as const), accountId: account.id, toAccountId: null, toAmount: null, categoryId: l.categoryId ?? null };
          if (values.categoryId) {
            const cat = getCategory(tx as unknown as Db, req.workspaceId, values.categoryId);
            if (cat.kind !== values.kind) values.categoryId = null;
          }
          tx.insert(transactions)
            .values({
              id: transactionId,
              workspaceId: req.workspaceId,
              date: l.date,
              amount: abs,
              note: l.description,
              memberId: l.memberId ?? null,
              importId: id,
              ...values,
            })
            .run();
        }
        tx.insert(importLines).values({ importId: id, accountId: account.id, key: l.key, transactionId }).run();
      }
      tx.update(accounts)
        .set({ importMapping: JSON.stringify(body.mapping), updatedAt: new Date().toISOString() })
        .where(eq(accounts.id, account.id))
        .run();
      return tx.select().from(imports).where(eq(imports.id, id)).get()!;
    });
    reply.code(201);
    return { ...result, skippedCount: included.length - fresh.length };
  });

  app.get('/imports', async (req) => {
    const q = z.object({ accountId: z.string().uuid().optional() }).parse(req.query);
    return vault.db
      .select()
      .from(imports)
      .where(q.accountId ? and(eq(imports.workspaceId, req.workspaceId), eq(imports.accountId, q.accountId)) : eq(imports.workspaceId, req.workspaceId))
      .orderBy(desc(imports.createdAt))
      .all();
  });

  // Undoes an import: removes the transactions it created; lines it matched to existing ones are unlinked.
  app.delete('/imports/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const row = vault.db
      .select()
      .from(imports)
      .where(and(eq(imports.id, id), eq(imports.workspaceId, req.workspaceId)))
      .get();
    if (!row) throw notFound('Import');
    vault.db.transaction((tx) => {
      tx.delete(importLines).where(eq(importLines.importId, id)).run();
      tx.delete(transactions).where(eq(transactions.importId, id)).run();
      tx.delete(imports).where(eq(imports.id, id)).run();
    });
    reply.code(204);
  });

  // --- Rules ---------------------------------------------------------------------------------

  const checkRule = (workspaceId: string, body: Partial<z.infer<typeof ruleInput>>) => {
    if (body.categoryId) getCategory(vault.db, workspaceId, body.categoryId);
    if (body.memberId) getMember(vault.db, workspaceId, body.memberId);
    if (body.transferAccountId) getAccount(vault.db, workspaceId, body.transferAccountId);
  };
  const getRule = (workspaceId: string, id: string) => {
    const rule = vault.db
      .select()
      .from(categoryRules)
      .where(and(eq(categoryRules.id, id), eq(categoryRules.workspaceId, workspaceId)))
      .get();
    if (!rule) throw notFound('Rule');
    return rule;
  };

  app.get('/category-rules', async (req) =>
    vault.db.select().from(categoryRules).where(eq(categoryRules.workspaceId, req.workspaceId)).orderBy(categoryRules.pattern).all(),
  );

  app.post('/category-rules', async (req, reply) => {
    const body = ruleInput.parse(req.body);
    if (!body.categoryId && !body.memberId && !body.transferAccountId) throw new HttpError(400, 'rule_empty');
    checkRule(req.workspaceId, body);
    reply.code(201);
    return vault.db
      .insert(categoryRules)
      .values({ id: randomUUID(), workspaceId: req.workspaceId, ...body })
      .returning()
      .get();
  });

  app.put('/category-rules/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    getRule(req.workspaceId, id);
    const body = ruleInput.partial().parse(req.body);
    checkRule(req.workspaceId, body);
    return vault.db
      .update(categoryRules)
      .set({ ...body, updatedAt: new Date().toISOString() })
      .where(eq(categoryRules.id, id))
      .returning()
      .get();
  });

  app.delete('/category-rules/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    getRule(req.workspaceId, id);
    vault.db.delete(categoryRules).where(eq(categoryRules.id, id)).run();
    reply.code(204);
  });

  // Applies the rules to existing uncategorised transactions (e.g. after adding a rule).
  app.post('/category-rules/apply', async (req) => {
    const rules = vault.db.select().from(categoryRules).where(eq(categoryRules.workspaceId, req.workspaceId)).all();
    const cats = new Map(
      vault.db
        .select()
        .from(categories)
        .where(eq(categories.workspaceId, req.workspaceId))
        .all()
        .map((c) => [c.id, c]),
    );
    const open = vault.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.workspaceId, req.workspaceId), inArray(transactions.kind, ['income', 'expense'])))
      .all()
      .filter((t) => !t.categoryId || !t.memberId);
    let updated = 0;
    vault.db.transaction((tx) => {
      for (const t of open) {
        const rule = matchRule(rules, t.note);
        if (!rule) continue;
        const cat = rule.categoryId ? cats.get(rule.categoryId) : undefined;
        const patch = {
          categoryId: t.categoryId ?? (cat?.kind === t.kind ? cat.id : null),
          memberId: t.memberId ?? rule.memberId ?? null,
        };
        if (patch.categoryId === t.categoryId && patch.memberId === t.memberId) continue;
        tx.update(transactions).set(patch).where(eq(transactions.id, t.id)).run();
        updated++;
      }
    });
    return { updated };
  });
}
