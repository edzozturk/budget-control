import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const currencyCode = z.string().length(3).toUpperCase();
// Money travels as an integer in the currency's minor unit (e.g. 1250 = 12.50 TRY).
export const minorAmount = z.number().int();
export const idParam = z.object({ id: z.string().uuid() });

export const SESSION_COOKIE = 'bc_session';
