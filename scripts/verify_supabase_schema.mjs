// Usage: node scripts/verify_supabase_schema.mjs <installed @electric-sql/pglite path>
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Pass a local PGlite module entry point.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  await db.exec(await readFile('supabase/migrations/20261025130000_prepare_club_storage.sql', 'utf8'));
  const tables = await db.query("select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'club_%'");
  assert.equal(tables.rows.length, 12);
  assert.ok(tables.rows.every(t => t.rowsecurity));
  for (const role of ['anon', 'authenticated']) {
    const permissions = await db.query("select has_table_privilege($1, 'public.club_player_birth_years', 'SELECT') as read, has_table_privilege($1, 'public.club_records', 'INSERT') as write, has_function_privilege($1, 'public.club_connection_status()', 'EXECUTE') as probe", [role]);
    assert.deepEqual(permissions.rows[0], { read: false, write: false, probe: false });
  }
  const sql = await readFile('.local/supabase/public-csv-import.sql', 'utf8');
  await db.exec('set role service_role;');
  await db.exec(sql); await db.exec(sql); // Import can be repeated without duplicated records.
  assert.equal((await db.query('select count(*)::int as n from public.club_records')).rows[0].n, 150);
  assert.equal((await db.query('select count(*)::int as n from public.club_competition_records')).rows[0].n, 298);
  assert.equal((await db.query('select public.club_connection_status() as status')).rows[0].status.schemaVersion, '20261025130000');
  const sample = { participants: [{ name: '테스트 선수', comment: "따옴표 ' 와 줄바꿈\n확인" }], draft: null };
  await db.query('insert into public.club_weekend_training(date, session_json) values ($1, $2)', ['2026-10-25', sample]);
  assert.deepEqual((await db.query('select session_json from public.club_weekend_training')).rows[0].session_json, sample);
  console.log('PostgreSQL verified: 12 tables, RLS/grants, server probe, repeated CSV import (448 records), Korean JSON round trip.');
} finally { await db.close(); }
