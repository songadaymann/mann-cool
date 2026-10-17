import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'external-plays-test-'));
await build({entryPoints:['worker/index.js'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent'});
const {default:worker}=await import(path.join(temp,'worker.mjs'));
after(()=>fs.rm(temp,{recursive:true,force:true}));
const schema=await fs.readFile('migrations/0001_platform.sql','utf8');
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(schema);t.after(()=>db.close());
 const wrap=statement=>{let values=[];return{bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async all(){return{results:statement.all(...values)};},async run(){return{meta:{changes:statement.run(...values).changes}};}};};
 const env={DB:{prepare:sql=>wrap(db.prepare(sql))}};
 const request=(url,init={})=>worker.fetch(new Request('https://mann.cool'+url,{...init,headers:{origin:'https://wamp.land','content-type':'application/json','cf-connecting-ip':'192.0.2.91',...init.headers}}),env);
 const api=async(url,body)=>{const r=await request(url,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});assert.equal(r.headers.get('access-control-allow-origin'),'*');return{status:r.status,...await r.json()};};
 return {db,request,api};
}
test('external WAMP plays work on both API versions with separate source counts',async t=>{
 const f=fixture(t);assert.deepEqual(await f.api('/api/v1/plays?slug=wamp'),{status:200,slug:'wamp',count:0});
 for(const endpoint of ['/api/plays','/api/v1/plays']){const r=await f.api(endpoint,{slug:'wamp',source:endpoint.includes('v1')?'mann.cool':'direct'});assert.equal(r.status,200);assert.equal(r.count,1);}
 assert.equal((await f.api('/api/v1/plays?slug=wamp')).count,2);
 assert.equal((await f.api('/api/v1/plays')).counts.wamp,2);
 assert.deepEqual({...f.db.prepare('SELECT slug,title,status,leaderboard_enabled FROM games WHERE slug=?').get('wamp')},{slug:'wamp',title:'WAMP',status:'hidden',leaderboard_enabled:0});
 const preflight=await f.request('/api/v1/plays',{method:'OPTIONS'});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);assert.match(preflight.headers.get('access-control-allow-headers'),/Content-Type/);
});
test('registration is play-only and unknown games still fail',async t=>{
 const f=fixture(t);await f.api('/api/v1/plays?slug=wamp');
 for(const endpoint of ['plays','guestbook','leaderboard','tip-clicks'])assert.equal((await f.api('/api/v1/'+endpoint+'?slug=unknown-fixture')).status,404);
 for(const endpoint of ['guestbook','leaderboard','tip-clicks'])assert.equal((await f.api('/api/v1/'+endpoint+'?slug=wamp')).status,404);
 assert.equal((await f.api('/api/v1/plays',{slug:'unknown-fixture'})).status,404);
 assert.equal((await f.api('/api/v1/plays?slug=../wamp')).status,400);
 assert.equal((await f.api('/api/v1/plays',{slug:'wamp',source:'https://private.invalid/user'})).source,'direct');
});
test('historical WAMP import preserves live plays and remains idempotent',async t=>{
 const f=fixture(t);
 await f.api('/api/v1/plays',{slug:'wamp',source:'direct'});
 await f.api('/api/v1/plays',{slug:'pong',source:'direct'});
 const migration=await fs.readFile('migrations/0011_wamp_historical_plays.sql','utf8');
 f.db.exec(migration);f.db.exec(migration);
 assert.equal((await f.api('/api/v1/plays?slug=wamp')).count,66586);
 assert.equal((await f.api('/api/v1/plays',{slug:'wamp',source:'mann.cool'})).count,1);
 assert.equal((await f.api('/api/plays?slug=wamp')).count,66587);
 const all=await f.api('/api/v1/plays');
 assert.equal(all.counts.wamp,66587);assert.equal(all.counts.pong,1);
 assert.equal(f.db.prepare("SELECT play_count FROM play_totals WHERE slug='wamp' AND source='history-before-2026-10-17'").get().play_count,66585);
 f.db.exec(migration);
 assert.equal((await f.api('/api/v1/plays?slug=wamp')).count,66587);
});
test('historical import also works before WAMP is first registered',async t=>{
 const f=fixture(t);
 f.db.exec(await fs.readFile('migrations/0011_wamp_historical_plays.sql','utf8'));
 assert.equal((await f.api('/api/v1/plays?slug=wamp')).count,66585);
 assert.equal((await f.api('/api/v1/plays',{slug:'wamp',source:'direct'})).count,1);
 assert.equal((await f.api('/api/v1/plays')).counts.wamp,66586);
});
