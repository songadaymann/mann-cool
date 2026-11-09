import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {calculatePdoomScore,pdoomReviewReasons,pdoomReviewTop,cleanVideoUrl} from '../worker/pdoom-scores.js';
import {readJson,hashIdentity} from '../worker/lib/http.js';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {parseSiweMessage} from 'viem/siwe';

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pdoom-api-test-'));
await build({entryPoints:[fileURLToPath(new URL('../worker/index.js',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent'});
const {default:worker}=await import(path.join(temp,'worker.mjs'));
after(()=>fs.rm(temp,{recursive:true,force:true}));
const schema=await fs.readFile(new URL('../migrations/0001_platform.sql',import.meta.url),'utf8')
  +await fs.readFile(new URL('../migrations/0009_player_identity_wallets.sql',import.meta.url),'utf8')
  +await fs.readFile(new URL('../migrations/0010_pdoom_ranked_runs.sql',import.meta.url),'utf8')
  +await fs.readFile(new URL('../migrations/0012_player_wallets.sql',import.meta.url),'utf8');
// One board: the whole game as a speedrun, from the first level to the MCP going down. Lowest time wins.
const CAMPAIGN={levelId:'campaign',levelVersion:'campaign-v1',scoreVersion:'speedrun-v1',boardVersion:'v1'},VARIANT='campaign-speedrun-v1';
const RETIRED=['five-prisons-rescue-v3','hal-station-rescue-v3','meg3n-factory-rescue-v1','agentic-pods-rescue-v1','five-prisons-perfect-v3','hal-station-clean-sweep-v3'];
// A 30-minute run.
const SPLITS={'five-prisons':300000,'hal-station':360000,'meg3n-factory':420000,'agentic-pods':480000,'safe-mode':60000,endgame:180000};
const sum=splits=>Object.values(splits).reduce((a,b)=>a+b,0);
const metadata=(overrides={})=>({...CAMPAIGN,outcome:'complete',practice:false,saved:20,total:20,activeMs:sum(SPLITS),splits:{...SPLITS},restarts:2,ceo:'amodei',...overrides});
// Changes splits and keeps activeMs equal to their sum.
const timed=(changes,overrides={})=>{const splits={...SPLITS,...changes};return metadata({splits,activeMs:sum(splits),...overrides});};
// reviewTop: the Worker's PDOOM_REVIEW_TOP (off here unless a test asks; null leaves it unset, the default ten).
function fixture(t,{reviewTop='0'}={}){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON;'+schema);t.after(()=>db.close());let requests=0;
  const wrap=statement=>{let values=[];return{bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async all(){return{results:statement.all(...values)};},async run(){return{meta:{changes:statement.run(...values).changes}};}};};
  const env={DB:{prepare:sql=>wrap(db.prepare(sql)),batch:async statements=>{const out=[];for(const s of statements)out.push(await s.run());return out;}},PLAYER_EMAIL_DEV:'1',...(reviewTop===null?{}:{PDOOM_REVIEW_TOP:reviewTop})};
  const api=async(url,body,headers={})=>{
    const response=await worker.fetch(new Request('https://example.test'+url,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'content-type':'application/json','cf-connecting-ip':`192.0.2.${++requests}`,...headers}}),env);
    return {status:response.status,...await response.json()};
  };
  // Tickets are issued when play begins, so a finished run's ticket is at least as old as its active time.
  const start=async(runId=randomUUID(),nonce=randomBytes(32).toString('hex'),playedMs=3600000)=>{
    const details={runId,nonce,...CAMPAIGN};
    const result=await api('/api/v1/pdoom/runs',details);assert.equal(result.status,201,JSON.stringify(result));
    db.prepare('UPDATE pdoom_ranked_runs SET issued_at = issued_at - ? WHERE id = ?').run(playedMs,result.ticketId);
    return {...details,runTicket:{id:result.ticketId,token:nonce}};
  };
  const body=(run,overrides={})=>({slug:'pdoom',variant:VARIANT,name:'Genuine fixture',playerId:'fixture-player',submissionId:`${run.runId}:${VARIANT}`,score:1,runTicket:run.runTicket,metadata:metadata(),...overrides});
  const board=async()=>(await api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries.map(entry=>entry.score);
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n;
  return {db,api,start,body,board,count};
}

test('a complete campaign scores its active time and the server rebuilds the metadata',()=>{
  const result=calculatePdoomScore(VARIANT,metadata({breakdown:{rescue:9e12},extra:'ignored'}));
  assert.equal(result.score,1800000);
  assert.deepEqual(result.metadata,{...CAMPAIGN,outcome:'complete',practice:false,saved:20,total:20,activeMs:1800000,splits:SPLITS,restarts:2,ceo:'amodei',validation:'server-rules-v2'});
  assert.deepEqual(Object.keys(result.metadata.splits),['five-prisons','hal-station','meg3n-factory','agentic-pods','safe-mode','endgame']);
  // Safe mode may record 0, the hero is optional, and each split may run up to 24 hours.
  assert.equal(calculatePdoomScore(VARIANT,timed({'safe-mode':0})).score,1740000);
  assert.equal(calculatePdoomScore(VARIANT,metadata({ceo:undefined})).metadata.ceo,undefined);
  assert.equal(calculatePdoomScore(VARIANT,metadata({ceo:'altman',restarts:0})).metadata.ceo,'altman');
  assert.equal(calculatePdoomScore(VARIANT,metadata({restarts:100000})).metadata.restarts,100000);
  assert.equal(calculatePdoomScore(VARIANT,timed({endgame:86400000})).score,1620000+86400000);
  assert.equal(calculatePdoomScore(VARIANT,timed({'five-prisons':1,'hal-station':1,'meg3n-factory':1,'agentic-pods':1,'safe-mode':0,endgame:1})).score,5);
  assert.throws(()=>calculatePdoomScore('five-prisons-rescue-v3',metadata()),/board does not belong/);
});
test('raw score forgeries fail on versioned and legacy API routes',async t=>{
  const f=fixture(t);
  for(const endpoint of ['/api/v1/leaderboard','/api/leaderboard']){
    assert.equal((await f.api(endpoint,{slug:'pdoom',variant:VARIANT,name:'Fake',score:1})).status,401);
    assert.equal((await f.api(endpoint,{slug:'pdoom',variant:VARIANT,name:'Fake',score:1,metadata:metadata()})).status,401);
  }
  assert.equal(f.count(),0);
});
test('tickets accept only the campaign descriptor and retry idempotently without exposing a recoverable secret',async t=>{
  const f=fixture(t),run=await f.start(),retry=await f.api('/api/v1/pdoom/runs',run);
  assert.equal(retry.ticketId,run.runTicket.id);
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,nonce:'f'.repeat(64)})).status,409);
  assert.notEqual(f.db.prepare('SELECT nonce_hash FROM pdoom_ranked_runs').get().nonce_hash,run.nonce);
  assert.deepEqual({...f.db.prepare('SELECT level_id, level_version FROM pdoom_ranked_runs').get()},{level_id:'campaign',level_version:'campaign-v1'});
  const fresh={runId:randomUUID(),nonce:randomBytes(32).toString('hex')};
  // The retired per-level descriptors, and anything not exactly the campaign's.
  for(const descriptor of [
    {levelId:'five-prisons',levelVersion:'five-prisons-v3',scoreVersion:'rescue-v2',boardVersion:'v3'},
    {levelId:'agentic-pods',levelVersion:'agentic-pods-v1',scoreVersion:'rescue-v2',boardVersion:'v1'},
    {...CAMPAIGN,levelId:'five-prisons'},{...CAMPAIGN,levelVersion:'campaign-v2'},{...CAMPAIGN,scoreVersion:'rescue-v2'},
    {...CAMPAIGN,boardVersion:'v3'},{...CAMPAIGN,boardVersion:undefined},{},
  ])assert.equal((await f.api('/api/v1/pdoom/runs',{...fresh,...descriptor})).status,400,JSON.stringify(descriptor));
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,levelVersion:'campaign-v2'})).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs',{...run,runId:[run.runId]})).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs')).status,405);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pdoom_ranked_runs').get().n,1);
});
test('the speedrun board ranks the lowest time first and preserves identical retries',async t=>{
  const f=fixture(t),ranks=[];
  for(const [changes,expected] of [[{},1],[{endgame:120000},1],[{endgame:780000},3]]){
    const run=await f.start(),body=f.body(run,{metadata:timed(changes)}),response=await f.api('/api/v1/leaderboard',body);
    assert.equal(response.status,201,JSON.stringify(response));assert.equal(response.entry.score,body.metadata.activeMs);
    assert.equal(response.entry.metadata.validation,'server-rules-v2');assert.deepEqual(response.entry.metadata.splits,body.metadata.splits);
    assert.equal(response.rank,expected);ranks.push(response.rank);
    const retry=await f.api('/api/leaderboard',{...body,score:-999});
    assert.equal(retry.status,200);assert.equal(retry.entry.score,response.entry.score);
    assert.ok(!JSON.stringify(response).includes(run.nonce));assert.ok(!JSON.stringify(response).includes(run.runTicket.id));
  }
  assert.equal(f.count(),3);
  const data=await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT);
  assert.deepEqual(data.entries.map(entry=>entry.score),[1740000,1800000,2400000]);
  assert.deepEqual(data.entries.map(entry=>entry.rank),[1,2,3]);
  assert.equal(data.direction,'asc');assert.equal(data.board.label,'Speedrun');assert.equal(data.board.display,'time-ms');assert.equal(data.board.aggregation,'player-best');
});
test('incomplete, practice and inconsistent runs are rejected without consuming the ticket',async t=>{
  const f=fixture(t),run=await f.start(),{endgame,...withoutEndgame}=SPLITS;
  const rejected=[
    // Wrong descriptor.
    metadata({levelId:'five-prisons'}),metadata({levelVersion:'campaign-v2'}),metadata({scoreVersion:'rescue-v2'}),metadata({boardVersion:'v3'}),
    // Not a complete, real run that rescued everyone.
    metadata({outcome:'escaped'}),metadata({outcome:'lost'}),metadata({practice:true}),metadata({practice:undefined}),metadata({practice:'false'}),
    metadata({saved:19}),metadata({total:19}),metadata({saved:19,total:19}),metadata({total:21}),metadata({saved:'20'}),
    // Missing, extra or malformed splits.
    metadata({splits:withoutEndgame,activeMs:sum(withoutEndgame)}),metadata({splits:{...SPLITS,bonus:0}}),metadata({splits:{...SPLITS,bonus:1},activeMs:sum(SPLITS)+1}),
    metadata({splits:undefined}),metadata({splits:null}),metadata({splits:Object.values(SPLITS)}),metadata({splits:{...SPLITS,'safe-mode':'60000'}}),
    // A level or the endgame with no time, or a split out of range.
    timed({'five-prisons':0}),timed({'hal-station':0}),timed({'meg3n-factory':0}),timed({'agentic-pods':0}),timed({endgame:0}),
    timed({'safe-mode':-1}),timed({'hal-station':1.5}),timed({'agentic-pods':86400001}),
    // Active time that is not exactly the sum of the splits.
    metadata({activeMs:1800001}),metadata({activeMs:1799999}),metadata({activeMs:0}),metadata({activeMs:'1800000'}),metadata({activeMs:undefined}),
    // Restarts and hero.
    metadata({restarts:-1}),metadata({restarts:1.5}),metadata({restarts:100001}),metadata({restarts:undefined}),
    metadata({ceo:'doomguy'}),metadata({ceo:'Altman'}),metadata({ceo:null}),
  ];
  for(const bad of rejected){
    const response=await f.api('/api/v1/leaderboard',f.body(run,{metadata:bad}));assert.equal(response.status,400,JSON.stringify(bad));
  }
  // A board that is not the speedrun.
  for(const variant of ['five-prisons-rescue-v3','agentic-pods-rescue-v1','campaign-speedrun-v2']){
    assert.equal((await f.api('/api/v1/leaderboard',f.body(run,{variant,submissionId:`${run.runId}:${variant}`}))).status,400,variant);
  }
  assert.equal(f.db.prepare('SELECT completion_hash FROM pdoom_ranked_runs').get().completion_hash,null);
  assert.equal(f.count(),0);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
});
test('wrong nonce, per-level tickets and mismatched submission IDs are rejected',async t=>{
  const f=fixture(t),run=await f.start();
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,{runTicket:{id:run.runTicket.id,token:'0'.repeat(64)}}))).status,401);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,{submissionId:'other-run:'+VARIANT}))).status,400);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run,{submissionId:`${run.runId}:five-prisons-rescue-v3`}))).status,400);
  // A ticket issued for a single level before the speedrun cannot complete a campaign run.
  const token=randomBytes(32).toString('hex'),id=randomUUID(),runId=randomUUID();
  f.db.prepare('INSERT INTO pdoom_ranked_runs (id, run_id, nonce_hash, level_id, level_version, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id,runId,await hashIdentity(token,'pdoom-run-v1'),'five-prisons','five-prisons-v3',Date.now()-3600000,Date.now()+86400000);
  assert.equal((await f.api('/api/v1/leaderboard',f.body({runId,runTicket:{id,token}}))).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs',{runId,nonce:token,...CAMPAIGN})).status,409);
  assert.equal(f.count(),0);
});
test('one atomic completion wins against conflicting concurrent results',async t=>{
  const f=fixture(t),run=await f.start(),original=f.body(run),changed=f.body(run,{metadata:timed({endgame:120000})});
  const responses=await Promise.all([f.api('/api/v1/leaderboard',original),f.api('/api/v1/leaderboard',changed)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal(f.count(),1);
  const winner=responses.find(r=>r.status===201);assert.equal((await f.api('/api/v1/leaderboard',winner.entry.score===1800000?original:changed)).entry.score,winner.entry.score);
  const loser=winner.entry.score===1800000?changed:original;assert.equal((await f.api('/api/v1/leaderboard',loser)).status,409);
});
test('long-paused/offline attempts and accepted-ticket retries retain a generous lifetime',async t=>{
  const f=fixture(t),run=await f.start();
  f.db.prepare('UPDATE pdoom_ranked_runs SET issued_at = ? WHERE id = ?').run(Date.now()-80*86400000,run.runTicket.id);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
  f.db.prepare('UPDATE pdoom_ranked_runs SET expires_at = 1 WHERE id = ?').run(run.runTicket.id);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
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

test('retired per-level boards reject reads and writes without deleting their stored records',async t=>{
  const f=fixture(t),run=await f.start();
  for(const variant of RETIRED){
    f.db.prepare('INSERT INTO leaderboard_entries (submission_id,slug,variant,player_name,score) VALUES (?, ?, ?, ?, ?)').run('archive:'+variant,'pdoom',variant,'Previous run',55200);
    for(const endpoint of ['/api/v1/leaderboard','/api/leaderboard']){
      assert.equal((await f.api(`${endpoint}?slug=pdoom&variant=${variant}`)).status,400);
      assert.equal((await f.api(endpoint,f.body(run,{variant,submissionId:`${run.runId}:${variant}`}))).status,400);
    }
  }
  assert.equal(f.count(),RETIRED.length);
  assert.equal(f.db.prepare('SELECT completion_hash FROM pdoom_ranked_runs').get().completion_hash,null);
  assert.deepEqual(await f.board(),[]);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(run))).status,201);
  assert.deepEqual(await f.board(),[1800000]);
});

test('implausibly fast runs are stored for review instead of rejected or ranked',async t=>{
  const f=fixture(t),now=Date.now();
  // The floor is 20 minutes; the faster-than-real-time check allows ten seconds of clock slack.
  assert.deepEqual(pdoomReviewReasons({activeMs:1199999},now-3600000,now),['below-time-floor']);
  assert.deepEqual(pdoomReviewReasons({activeMs:1200000},now-3600000,now),[]);
  assert.deepEqual(pdoomReviewReasons({activeMs:1800000},now-1790000,now),[]);
  assert.deepEqual(pdoomReviewReasons({activeMs:1800000},now-1789999,now),['faster-than-real-time']);
  assert.deepEqual(pdoomReviewReasons({activeMs:600000},now-1000,now),['below-time-floor','faster-than-real-time']);
  // 19:59.999 of active play.
  const blink=await f.start(),blinkBody=f.body(blink,{metadata:timed({'five-prisons':200000,'hal-station':200000,'meg3n-factory':200000,'agentic-pods':200000,'safe-mode':0,endgame:399999})});
  const held=await f.api('/api/v1/leaderboard',blinkBody);
  assert.equal(held.status,201,JSON.stringify(held));assert.equal(held.held,true);assert.equal(held.rank,null);assert.equal(held.entry.score,1199999);
  assert.deepEqual(held.entry.metadata.review,['below-time-floor']);
  const retry=await f.api('/api/v1/leaderboard',blinkBody);assert.equal(retry.held,true);assert.equal(retry.entry.score,held.entry.score);
  // Thirty active minutes claimed ten real minutes after the ticket was issued.
  const early=await f.start(randomUUID(),randomBytes(32).toString('hex'),600000);
  const rushed=await f.api('/api/v1/leaderboard',f.body(early));
  assert.equal(rushed.held,true);assert.deepEqual(rushed.entry.metadata.review,['faster-than-real-time']);
  const normal=await f.api('/api/v1/leaderboard',f.body(await f.start()));
  assert.equal(normal.held,undefined);assert.equal(normal.rank,1);assert.equal(normal.entry.metadata.review,undefined);
  assert.deepEqual(await f.board(),[1800000]);
  assert.deepEqual(f.db.prepare("SELECT moderation_status AS status, COUNT(*) AS n FROM leaderboard_entries GROUP BY status ORDER BY status").all().map(r=>[r.status,r.n]),[['approved',1],['pending',2]]);
  f.db.prepare("UPDATE leaderboard_entries SET moderation_status = 'approved' WHERE submission_id = ?").run(blinkBody.submissionId);
  assert.deepEqual(await f.board(),[1199999,1800000]);
});

test('every time that would make the top ten is held for review, by default (2026-11-09)',async t=>{
  assert.equal(pdoomReviewTop({}),10);assert.equal(pdoomReviewTop({PDOOM_REVIEW_TOP:'3'}),3);assert.equal(pdoomReviewTop({PDOOM_REVIEW_TOP:'0'}),0);assert.equal(pdoomReviewTop({PDOOM_REVIEW_TOP:'x'}),10);
  const f=fixture(t,{reviewTop:null}),approve=id=>f.db.prepare("UPDATE leaderboard_entries SET moderation_status = 'approved' WHERE submission_id = ?").run(id);
  // An empty board: the first runs are all top ten, so all held.
  const first=f.body(await f.start()),held=await f.api('/api/v1/leaderboard',first);
  assert.equal(held.held,true);assert.deepEqual(held.entry.metadata.review,['top-ten']);assert.deepEqual(await f.board(),[]);
  approve(first.submissionId);
  // Ten approved runs (30:00 and nine at 25:01..25:09): a slower run (31:00) lands 11th and goes straight on; a faster one is held.
  for(let i=1;i<10;i++){const b=f.body(await f.start(),{metadata:timed({'agentic-pods':180000+i*1000})});const r=await f.api('/api/v1/leaderboard',b);assert.equal(r.status,201,JSON.stringify(r));approve(b.submissionId);}
  assert.equal((await f.board()).length,10);
  const slow=await f.api('/api/v1/leaderboard',f.body(await f.start(),{metadata:timed({endgame:180000+60000})}));
  assert.equal(slow.held,undefined,JSON.stringify(slow));assert.equal(slow.rank,11);
  const fast=await f.api('/api/v1/leaderboard',f.body(await f.start(),{metadata:timed({'agentic-pods':80000})}));
  assert.equal(fast.held,true);assert.deepEqual(fast.entry.metadata.review,['top-ten']);
});
test('a run can carry a link to its recording, given with the time or added later from the browser that played it',async t=>{
  assert.equal(cleanVideoUrl(''),null);assert.equal(cleanVideoUrl(undefined),null);
  assert.equal(cleanVideoUrl('https://youtu.be/abc123'),'https://youtu.be/abc123');assert.equal(cleanVideoUrl('https://www.twitch.tv/videos/1'),'https://www.twitch.tv/videos/1');
  assert.equal(cleanVideoUrl('https://drive.google.com/file/d/x/view'),'https://drive.google.com/file/d/x/view');
  for(const bad of ['http://youtu.be/abc','https://evil.example/watch','javascript:alert(1)','https://youtube.com.evil.example/x','https://user:pw@youtube.com/x','https://youtube.com:8443/x','https://docs.google.com/x','https://'+'a'.repeat(300)+'.youtube.com'])
    assert.throws(()=>cleanVideoUrl(bad),/link|video/,bad);
  const f=fixture(t),run=await f.start(),body=f.body(run,{videoUrl:'https://youtu.be/first'});
  const sent=await f.api('/api/v1/leaderboard',body);assert.equal(sent.status,201,JSON.stringify(sent));assert.equal(sent.entry.metadata.videoUrl,'https://youtu.be/first');
  assert.equal((await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries[0].videoUrl,'https://youtu.be/first','the board shows it');
  // a bad link refuses the submission without binding the ticket
  const other=await f.start(),refused=await f.api('/api/v1/leaderboard',f.body(other,{videoUrl:'https://evil.example/x'}));assert.equal(refused.status,400);
  assert.equal(f.db.prepare('SELECT completed_at FROM pdoom_ranked_runs WHERE id = ?').get(other.runTicket.id).completed_at,null);
  // later: change it, then clear it; the time and status stay
  const changed=await f.api('/api/v1/pdoom/runs/video',{runTicket:run.runTicket,videoUrl:'https://vimeo.com/42'});
  assert.equal(changed.status,200,JSON.stringify(changed));assert.equal(changed.videoUrl,'https://vimeo.com/42');assert.equal(changed.held,false);
  let row=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries[0];assert.equal(row.videoUrl,'https://vimeo.com/42');assert.equal(row.score,body.metadata.activeMs);
  assert.equal((await f.api('/api/v1/pdoom/runs/video',{runTicket:run.runTicket,videoUrl:''})).status,200);
  row=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries[0];assert.equal(row.videoUrl,undefined);
  // only with the run's own token, only for a submitted run, only a video site
  assert.equal((await f.api('/api/v1/pdoom/runs/video',{runTicket:{...run.runTicket,token:'0'.repeat(64)},videoUrl:'https://youtu.be/x'})).status,401);
  assert.equal((await f.api('/api/v1/pdoom/runs/video',{runTicket:(await f.start()).runTicket,videoUrl:'https://youtu.be/x'})).status,409);
  assert.equal((await f.api('/api/v1/pdoom/runs/video',{runTicket:run.runTicket,videoUrl:'https://evil.example/x'})).status,400);
  assert.equal((await f.api('/api/v1/pdoom/runs/video',{runTicket:run.runTicket})).status,200,'no link clears it');
});

// A browser's player: its secret, and (once saved to an email through the real code flow, dev mode) signed in.
const secret=()=>randomBytes(32).toString('base64url');
async function signIn(f,playerSecret,email){
  const started=await f.api('/api/v1/player/email/start',{secret:playerSecret,email});assert.equal(started.status,200,JSON.stringify(started));
  const verified=await f.api('/api/v1/player/email/verify',{secret:playerSecret,email,code:started.devCode});assert.equal(verified.status,200,JSON.stringify(verified));
  return verified.playerId;
}
test('the board shows each player once, their best; signing in (even later) marks their row; nobody can post as someone else',async t=>{
  const f=fixture(t),alice=secret(),bob=secret();
  const post=async(playerSecret,changes,overrides={})=>{const r=await f.api('/api/v1/leaderboard',f.body(await f.start(),{metadata:timed(changes),...(playerSecret?{playerSecret}:{}),...overrides}));assert.equal(r.status,201,JSON.stringify(r));return r;};
  await post(alice,{endgame:240000});await post(alice,{endgame:120000});await post(alice,{endgame:300000});
  await post(bob,{endgame:200000});
  await post(null,{endgame:100000});await post(null,{endgame:110000});
  let rows=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries;
  assert.deepEqual(rows.map(r=>r.score),[1720000,1730000,1740000,1820000],'two anonymous runs, then Alice once (her best), then Bob');
  assert.deepEqual(rows.map(r=>r.signedIn),[false,false,false,false]);
  const aliceId=rows[2].playerId;assert.match(aliceId,/^mc_/);assert.equal(rows[0].playerId,null,'an anonymous run has no player');
  // Alice saves her scores to an email: her row is signed in, without resubmitting
  assert.equal(await signIn(f,alice,'alice@example.test'),aliceId);
  rows=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries;
  assert.deepEqual(rows.map(r=>[r.score,r.signedIn]),[[1720000,false],[1730000,false],[1740000,true],[1820000,false]]);
  // claiming Alice's public ID without her secret posts an anonymous run, not hers
  const forged=await post(null,{endgame:90000},{playerId:aliceId,name:'Not Alice'});assert.equal(forged.entry.playerId,null);
  rows=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries;
  assert.equal(rows[0].name,'Not Alice');assert.equal(rows[0].signedIn,false);assert.equal(rows.filter(r=>r.playerId===aliceId).length,1);
  // a new run from Alice's signed-in browser joins her row; her secret is never stored
  await post(alice,{endgame:60000});
  rows=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries;
  assert.equal(rows[0].playerId,aliceId);assert.equal(rows[0].score,1680000);assert.equal(rows[0].signedIn,true);assert.equal(rows.length,5);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM leaderboard_entries WHERE metadata LIKE ?").get('%'+alice+'%').n,0);
  assert.equal((await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:'not-a-secret'}))).status,400);
});
test('the top-ten hold counts players, not runs',async t=>{
  const f=fixture(t,{reviewTop:'3'}),approve=()=>f.db.prepare("UPDATE leaderboard_entries SET moderation_status = 'approved'").run();
  const one=secret();
  for(let i=0;i<4;i++)await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:one,metadata:timed({endgame:100000+i*1000})}));
  approve();
  // four approved runs, but one player: a slower run from someone else is still inside the top three
  const held=await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:secret()}));
  assert.equal(held.held,true);assert.deepEqual(held.entry.metadata.review,['top-ten']);
  approve();await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:secret(),metadata:timed({endgame:150000})}));approve();
  // now three players are ahead: a fourth player's slower run goes straight on, ranked 4th
  const slow=await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:secret(),metadata:timed({endgame:400000})}));
  assert.equal(slow.held,undefined,JSON.stringify(slow));assert.equal(slow.rank,4);
});

// Wallet sign-in (Sign-In with Ethereum, 2026-11-09): the server writes the message, the wallet signs it.
const MANN={origin:'https://mann.cool'};
async function walletSignIn(f,playerSecret,account,{chainId=1,origin=MANN.origin,sign=m=>account.signMessage({message:m})}={}){
  const started=await f.api('/api/v1/player/wallet/start',{secret:playerSecret,address:account.address.toLowerCase(),chainId},{origin});
  if(started.status!==200)return started;
  return f.api('/api/v1/player/wallet/verify',{secret:playerSecret,message:started.message,signature:await sign(started.message)},{origin});
}
test('a wallet signs in by signing the message the server wrote, and its player counts as signed in',async t=>{
  const f=fixture(t),browser=secret(),wallet=privateKeyToAccount(generatePrivateKey());
  const started=await f.api('/api/v1/player/wallet/start',{secret:browser,address:wallet.address.toLowerCase(),chainId:8453},MANN);
  assert.equal(started.status,200,JSON.stringify(started));
  const parsed=parseSiweMessage(started.message);
  assert.equal(parsed.domain,'mann.cool');assert.equal(parsed.uri,'https://mann.cool');assert.equal(parsed.address,wallet.address,'checksummed');assert.equal(parsed.chainId,8453);
  assert.match(started.message,/costs nothing and sends no transaction/);assert.ok(parsed.expirationTime-parsed.issuedAt<=600000);
  const signed=await f.api('/api/v1/player/wallet/verify',{secret:browser,message:started.message,signature:await wallet.signMessage({message:started.message})},MANN);
  assert.equal(signed.status,200,JSON.stringify(signed));assert.equal(signed.linked,true);assert.equal(signed.walletHint,`${wallet.address.slice(0,6)}…${wallet.address.slice(-4)}`);
  const session=await f.api('/api/v1/player/session',{secret:browser});assert.equal(session.linked,true);assert.equal(session.walletHint,signed.walletHint);assert.equal(session.playerId,signed.playerId);
  // its runs carry the ✓
  await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:browser}));
  const row=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries[0];assert.equal(row.playerId,signed.playerId);assert.equal(row.signedIn,true);
  // the same message can't be used twice
  assert.equal((await f.api('/api/v1/player/wallet/verify',{secret:browser,message:started.message,signature:await wallet.signMessage({message:started.message})},MANN)).status,400);
});
test('wallet sign-in refuses the wrong signer, a changed message, another browser, an old request and other sites',async t=>{
  const f=fixture(t),browser=secret(),wallet=privateKeyToAccount(generatePrivateKey()),other=privateKeyToAccount(generatePrivateKey());
  assert.equal((await walletSignIn(f,browser,wallet,{sign:m=>other.signMessage({message:m})})).status,400,'signed by someone else');
  assert.equal((await walletSignIn(f,browser,wallet,{sign:m=>wallet.signMessage({message:m.replace('mann.cool wants','evil.example wants')})})).status,400,'a different message');
  // a message started by one browser can't be finished by another
  const started=await f.api('/api/v1/player/wallet/start',{secret:browser,address:wallet.address,chainId:1},MANN);
  assert.equal((await f.api('/api/v1/player/wallet/verify',{secret:secret(),message:started.message,signature:await wallet.signMessage({message:started.message})},MANN)).status,400);
  // ten minutes on, it has expired
  const late=await f.api('/api/v1/player/wallet/start',{secret:browser,address:wallet.address,chainId:1},MANN);
  f.db.prepare('UPDATE player_wallet_challenges SET expires_at = 1').run();
  assert.equal((await f.api('/api/v1/player/wallet/verify',{secret:browser,message:late.message,signature:await wallet.signMessage({message:late.message})},MANN)).status,400);
  assert.equal((await walletSignIn(f,browser,wallet,{origin:'https://evil.example'})).status,403,'only from mann.cool');
  assert.equal((await f.api('/api/v1/player/wallet/start',{secret:browser,address:'0x123',chainId:1},MANN)).status,400);
  assert.equal((await f.api('/api/v1/player/session',{secret:browser})).linked,false,'nothing linked');
  assert.equal((await walletSignIn(f,browser,wallet)).linked,true,'and the real thing works');
});
test('a second browser with the same wallet joins the player and brings its scores; email and wallet share one player',async t=>{
  const f=fixture(t),first=secret(),second=secret(),wallet=privateKeyToAccount(generatePrivateKey());
  const a=await walletSignIn(f,first,wallet);
  await f.api('/api/v1/leaderboard',f.body(await f.start(),{playerSecret:second,name:'Second browser'}));
  const b=await walletSignIn(f,second,wallet);
  assert.equal(b.playerId,a.playerId);assert.equal(b.merged,1,'its run joined the player');
  let rows=(await f.api('/api/v1/leaderboard?slug=pdoom&variant='+VARIANT)).entries;assert.equal(rows[0].playerId,a.playerId);assert.equal(rows[0].signedIn,true);
  // the wallet player adds an email: still one player, now with an email hint
  const withEmail=await signIn(f,first,'wallet-player@example.test');assert.equal(withEmail,a.playerId);
  assert.match((await f.api('/api/v1/player/session',{secret:first})).emailHint,/^w•••@example\.test$/);
  // an email player adds a wallet: the same player
  const emailFirst=secret(),id=await signIn(f,emailFirst,'email-first@example.test'),fresh=privateKeyToAccount(generatePrivateKey());
  assert.equal((await walletSignIn(f,emailFirst,fresh)).playerId,id);
  // a wallet already saved to someone else can't join a browser saved to another player
  assert.equal((await walletSignIn(f,emailFirst,wallet)).status,409);
});
