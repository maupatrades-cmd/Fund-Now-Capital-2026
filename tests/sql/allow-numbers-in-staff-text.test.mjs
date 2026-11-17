import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Owner decision (17 Nov 2026): the long-number text guard is off. Loads the original guard (switchboard operations)
// then 20261117150000 and proves phone, ID and account numbers are accepted, and nothing else about the function moved.
const { PGlite } = await import(process.env.FNC_PGLITE_MODULE || '@electric-sql/pglite');
const mig = async (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('staff_text_is_safe accepts numbers of any length after the owner switched the guard off', async () => {
  const db = new PGlite();
  try {
    const original = await mig('20261007100000_switchboard_operations.sql');
    const start = original.indexOf('create or replace function public.staff_text_is_safe');
    await db.exec(original.slice(start, original.indexOf('$$;', start) + 3));
    const ok = async (t) => (await db.query('select public.staff_text_is_safe($1) as s', [t])).rows[0].s;
    assert.equal(await ok('Call 071 208 5218'), false, 'the old guard refused a phone number');
    await db.exec(await mig('20261117150000_allow_numbers_in_staff_text.sql'));
    for (const t of ['Call 071 208 5218', 'ID 8001015009087', 'Account 62012345678', null, '']) assert.equal(await ok(t), true);
    const fn = (await db.query("select provolatile, proconfig from pg_proc where proname = 'staff_text_is_safe'")).rows[0];
    assert.equal(fn.provolatile, 'i', 'still immutable, so the check constraints that use it stay valid');
  } finally {
    await db.close();
  }
});
