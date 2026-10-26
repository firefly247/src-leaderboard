import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import assert from 'node:assert/strict';
const entry=resolve(process.argv[2]);
const {PGlite}=await import(pathToFileURL(entry));
const {pgcrypto}=await import(pathToFileURL(join(dirname(entry),'contrib/pgcrypto.js')));
const db=new PGlite({extensions:{pgcrypto}});
try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create schema extensions;create extension pgcrypto with schema extensions;grant usage on schema public,extensions to anon,authenticated,service_role;');
 for(const name of ['20261025130000_prepare_club_storage.sql','20261026060000_storage_switch.sql','20261026090000_independent_api.sql','20261026093000_member_display.sql','20261026101500_member_catalog.sql'])await db.exec(await readFile('supabase/migrations/'+name,'utf8'));
 const id='00000000-0000-0000-0000-000000000001';
 await db.query('insert into auth.users values($1)',[id]);
 await db.exec("insert into public.club_player_birth_years values('김선수','1980','','2023');insert into public.club_events values('e1','2000m');");
 for(const role of ['anon','authenticated']){
  const p=(await db.query("select has_function_privilege($1,'public.club_admin_login(text)','execute') as login,has_function_privilege($1,'public.club_member_approve(uuid,text)','execute') as approve,has_table_privilege($1,'public.club_accounts','update') as role_write,has_table_privilege($1,'public.club_request_log','select') as audit_read",[role])).rows[0];
  assert.deepEqual(p,{login:false,approve:false,role_write:false,audit_read:false});
 }
 await db.exec('set role anon;');
 const publicData=(await db.query('select public.club_public_read() as v')).rows[0].v;
 assert.equal(Object.keys(publicData.tables).length,8);assert.ok(!JSON.stringify(publicData).includes('1980'));
 await db.exec('reset role;set role service_role;');
 assert.equal((await db.query('select public.club_admin_initialize($1) as v',['test-only-password'])).rows[0].v,true);
 assert.equal((await db.query('select public.club_admin_initialize($1) as v',['must-not-replace'])).rows[0].v,false);
 assert.notEqual((await db.query('select password_hash from public.club_admin_config')).rows[0].password_hash,'test-only-password');
 const login=(await db.query('select public.club_admin_login($1) as v',['test-only-password'])).rows[0].v;
 assert.equal(login.adminToken.length,72);assert.equal((await db.query('select public.club_admin_validate($1) as v',[login.adminToken])).rows[0].v,true);
 assert.equal((await db.query('select public.club_admin_validate($1) as v',['forged'])).rows[0].v,false);
 await assert.rejects(()=>db.query('select public.club_admin_login($1)',['wrong']),/invalid_credentials/);
 assert.equal((await db.query("select public.club_api_limit('test',2,300) as v")).rows[0].v,true);
 assert.equal((await db.query("select public.club_api_limit('test',2,300) as v")).rows[0].v,true);
 assert.equal((await db.query("select public.club_api_limit('test',2,300) as v")).rows[0].v,false);
 await db.query('insert into public.club_accounts(user_id,requested_player_name) values($1,$2)',[id,'김선수']);
 await assert.rejects(()=>db.query('select public.club_member_approve($1,$2)',[id,'다른선수']),/membership_request_changed/);
 assert.equal((await db.query('select public.club_member_approve($1,$2) as v',[id,'김선수'])).rows[0].v,true);
 const row=(await db.query('select player_name,role,requested_player_name from public.club_accounts')).rows[0];assert.deepEqual(row,{player_name:'김선수',role:'member',requested_player_name:null});
 await db.exec("insert into public.club_records(record_id,member_name) values('legacy','기록선수');");
 const second='00000000-0000-0000-0000-000000000002';await db.exec('reset role;');await db.query('insert into auth.users values($1)',[second]);await db.exec('set role service_role;');await db.query('insert into public.club_accounts(user_id,requested_player_name) values($1,$2)',[second,'기록선수']);assert.equal((await db.query('select public.club_member_approve($1,$2) as v',[second,'기록선수'])).rows[0].v,true);
 console.log('PostgreSQL verified: eight public datasets only; private tables/roles protected; bcrypt password initialization, sessions, rate limiting and verified member linking.');
}finally{await db.close();}
