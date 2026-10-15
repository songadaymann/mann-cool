import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {calculatePdoomScore} from '../worker/pdoom-scores.js';
import {readJson} from '../worker/lib/http.js';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pdoom-api-test-'));
await build({entryPoints:[fileURLToPath(new URL('../worker/index.js',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent'});
const {default:worker}=await import(path.join(temp,'worker.mjs'));
after(()=>fs.rm(temp,{recursive:true,force:true}));
const schema=await fs.readFile(new URL('../migrations/0001_platform.sql',import.meta.url),'utf8')
  +await fs.readFile(new URL('../migrations/0010_pdoom_ranked_runs.sql',import.meta.url),'utf8');
const metadata=(levelId='five-prisons',overrides={})=>({
  levelId,levelVersion:levelId+'-v3',scoreVersion:'rescue-v2',boardVersion:'v3',
  outcome:'escaped',practice:false,savedFigures:5,ceoState:'conscious',skill:3,entry:'cold',retreat:false,
  saved:6,total:6,camerasDestroyed:9,camerasTotal:9,activeTics:21000,activeMs:600000,
  pDoomAtCoverOpen:5,pDoomFinal:0,breakdown:{rescue:9e12},routes:[],ceo:'amodei',...overrides,
});
function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec(schema);t.after(()=>db.close());let requests=0;
  const wrap=statement=>{let values=[];return{bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async all(){return{results:statement.all(...values)};},async run(){return{meta:{changes:statement.run(...values).changes}};}};};
  const env={DB:{prepare:sql=>wrap(db.prepare(sql))}};
  const api=async(url,body,headers={})=>{
    const response=await worker.fetch(new Request('https://example.test'+url,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'content-type':'application/json','cf-connecting-ip':`192.0.2.${++requests}`,...headers}}),env);
    return {status:response.status,...await response.json()};
  };
  const start=async(levelId='five-prisons',runId=randomUUID(),nonce=randomBytes(32).toString('hex'))=>{
    const details={runId,nonce,levelId,levelVersion:levelId+'-v3',scoreVersion:'rescue-v2',boardVersion:'v3'};
    const result=await api('/api/v1/pdoom/runs',details);assert.equal(result.status,201,JSON.stringify(result));
    return {...details,runTicket:{id:result.ticketId,token:nonce}};
  };
  const body=(run,category='rescue',overrides={})=>({slug:'pdoom',variant:`${run.levelId}-${category}-v3`,name:'Genuine fixture',playerId:'fixture-player',submissionId:`${run.runId}:${run.levelId}-${category}-v3`,score:1e12,runTicket:run.runTicket,metadata:metadata(run.levelId),...overrides});
  return {db,api,start,body};
}

test('server formula handles both maps, carried CEOs and exact native-clock boundaries',()=>{
  for(const level of ['five-prisons','hal-station']){
    assert.equal(calculatePdoomScore(level+'-rescue-v3',metadata(level)).score,55200);
    assert.equal(calculatePdoomScore(level+'-perfect-v3',metadata(level)).score,600000);
    for(const figures of [0,1,5])for(const ceoState of ['conscious','carried']){
      const saved=figures+(ceoState==='conscious'?1:0);if(!saved)continue;
      for(const activeTics of [1,21000,2_147_483_647])for(const pDoomAtCoverOpen of [1,99]){
        const result=calculatePdoomScore(level+'-rescue-v3',metadata(level,{savedFigures:figures,saved,ceoState,activeTics,activeMs:Math.round(activeTics*1000/35),pDoomAtCoverOpen}));
        assert.ok(result.score>0&&result.score<=56240);
      }
    }
  }
});
test('raw score forgeries fail on versioned and legacy API routes',async t=>{
  const f=fixture(t);
  for(const endpoint of ['/api/v1/leaderboard','/api/leaderboard'])for(const variant of ['five-prisons-rescue-v3','hal-station-rescue-v3']){
    assert.equal((await f.api(endpoint,{slug:'pdoom',variant,name:'Fake',score:variant.includes('rescue')?1e12:-1})).status,401);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n,0);
});
test('tickets retry idempotently without exposing a recoverable secret',async t=>{
  const f=fixture(t),run=await f.start(),retry=await f.api('/api/v1/pdoom/runs',run);
  assert.equal(retry.ticketId,run.runTicket.id);
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,nonce:'f'.repeat(64)})).status,409);
  assert.notEqual(f.db.prepare('SELECT nonce_hash FROM pdoom_ranked_runs').get().nonce_hash,run.nonce);
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,levelVersion:'five-prisons-v2'})).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,runId:[run.runId]})).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs')).status,405);
});
test('both total-score boards use recalculated scores and preserve identical retries',async t=>{
  const f=fixture(t);
  for(const level of ['five-prisons','hal-station']){
    const run=await f.start(level);
    for(const category of ['rescue']){
      const body=f.body(run,category),response=await f.api('/api/v1/leaderboard',body);
      assert.equal(response.status,201,JSON.stringify(response));assert.equal(response.entry.score,55200);
      assert.equal(response.entry.metadata.validation,'server-rules-v1');assert.equal(response.entry.metadata.breakdown.rescue,50000);
      assert.equal((await f.api('/api/leaderboard',{...body,score:-999})).entry.score,response.entry.score);
      assert.ok(!JSON.stringify(response).includes(run.nonce));assert.ok(!JSON.stringify(response).includes(run.runTicket.id));
    }
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n,2);
});
test('inconsistent, practice and old-map results cannot consume a ticket',async t=>{
  const f=fixture(t),run=await f.start();
  for(const change of [{saved:7},{savedFigures:6},{saved:5},{total:5},{ceoState:'downed'},{camerasTotal:8},{camerasDestroyed:10},{camerasDestroyed:-1},{activeTics:0},{activeTics:1.1},{activeMs:-1},{pDoomAtCoverOpen:0},{pDoomFinal:1},{skill:2},{entry:'hub'},{entry:'replay'},{retreat:true},{practice:true},{outcome:'lost'},{levelVersion:'five-prisons-v2'}]){
    const response=await f.api('/api/v1/leaderboard',f.body(run,'rescue',{metadata:metadata(run.levelId,change)}));assert.equal(response.status,400,JSON.stringify(change));
  }
  assert.equal(f.db.prepare('SELECT completion_hash FROM pdoom_ranked_runs').get().completion_hash,null);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
});
test('wrong nonce, cross-map tickets and mismatched submission IDs are rejected',async t=>{
  const f=fixture(t),run=await f.start();
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,'rescue',{runTicket:{id:run.runTicket.id,token:'0'.repeat(64)}}))).status,401);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,'rescue',{submissionId:'other-run:five-prisons-rescue-v3'}))).status,400);
  assert.equal((await f.api('/api/v1/leaderboard',f.body({...run,levelId:'hal-station'}))).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n,0);
});
test('one atomic completion wins against conflicting concurrent results',async t=>{
  const f=fixture(t),run=await f.start(),original=f.body(run),changed=f.body(run,'rescue',{metadata:metadata(run.levelId,{pDoomAtCoverOpen:1})});
  const responses=await Promise.all([f.api('/api/v1/leaderboard',original),f.api('/api/v1/leaderboard',changed)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n,1);
  const winner=responses.find(r=>r.status===201);assert.equal((await f.api('/api/v1/leaderboard',winner.entry.metadata.pDoomAtCoverOpen===5?original:changed)).entry.score,winner.entry.score);
});
test('long-paused/offline attempts and accepted-ticket retries retain a generous lifetime',async t=>{
  const f=fixture(t),run=await f.start();
  f.db.prepare('UPDATE pdoom_ranked_runs SET issued_at = ? WHERE id = ?').run(Date.now()-80*86400000,run.runTicket.id);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
  f.db.prepare('UPDATE pdoom_ranked_runs SET expires_at = 1 WHERE id = ?').run(run.runTicket.id);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,'rescue'))).status,201);
  const unused=await f.start();f.db.prepare('UPDATE pdoom_ranked_runs SET expires_at = 1 WHERE id = ?').run(unused.runTicket.id);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(unused))).status,410);
});
test('other games retain their original numeric-score contract',async t=>{
  const f=fixture(t);assert.equal((await f.api('/api/v1/leaderboard',{slug:'sledding',name:'Other game',variant:'default',score:12})).status,201);
});
test('chunked bodies stop at the byte limit and preserve split UTF-8 text',async()=>{
  let cancelled=false,pulls=0;
  const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1024));},cancel(){cancelled=true;}});
  await assert.rejects(readJson(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'}),2048),error=>error.status===413);
  assert.equal(cancelled,true);assert.ok(pulls<10);
  const bytes=new TextEncoder().encode('{"name":"é"}');let at=0;
  const small=new ReadableStream({pull(controller){if(at===bytes.length)controller.close();else controller.enqueue(bytes.slice(at,++at));}});
  assert.deepEqual(await readJson(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:small,duplex:'half'}),100),{name:'é'});
  for(const value of ['null','[]','7'])await assert.rejects(readJson(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:value})),error=>error.status===400);
});

test('retired time boards reject reads and writes without deleting their stored records',async t=>{
  const f=fixture(t),run=await f.start();
  for(const level of ['five-prisons','hal-station'])for(const category of ['perfect','clean-sweep']){
    const variant=`${level}-${category}-v3`;
    f.db.prepare('INSERT INTO leaderboard_entries (submission_id,slug,variant,player_name,score) VALUES (?, ?, ?, ?, ?)').run('archive:'+variant,'pdoom',variant,'Previous run',600000);
    for(const endpoint of ['/api/v1/leaderboard','/api/leaderboard']){
      assert.equal((await f.api(`${endpoint}?slug=pdoom&variant=${variant}`)).status,400);
      assert.equal((await f.api(endpoint,f.body({...run,levelId:level},category))).status,400);
    }
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n,4);
  assert.equal(f.db.prepare('SELECT completion_hash FROM pdoom_ranked_runs').get().completion_hash,null);
  for(const level of ['five-prisons','hal-station']){
    const body=f.body(await f.start(level)),response=await f.api('/api/v1/leaderboard',body);assert.equal(response.status,201);
    const higher=f.body(await f.start(level),'rescue',{metadata:metadata(level,{pDoomAtCoverOpen:1})});assert.equal((await f.api('/api/v1/leaderboard',higher)).status,201);
    const data=await f.api('/api/v1/leaderboard?slug=pdoom&variant='+body.variant);assert.deepEqual(data.entries.map(entry=>entry.score),[55240,55200]);assert.equal(data.board.label,level==='five-prisons'?'Level 1':'Level 2');assert.equal(data.direction,'desc');
  }
});
