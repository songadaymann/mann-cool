import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {cloudflareWorkersStub} from './support/cloudflare-workers-stub.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Server-posted win/loss boards (Metal Gear Huang, 2026-11-18): only the game's own Worker, through the GameResults
// service-binding entrypoint, may post outcomes; browsers are refused.
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'game-results-test-'));
await build({entryPoints:['worker/index.js'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent',plugins:[cloudflareWorkersStub]});
const {default:worker,GameResults}=await import(path.join(temp,'worker.mjs'));
after(()=>fs.rm(temp,{recursive:true,force:true}));
const schema=await fs.readFile('migrations/0001_platform.sql','utf8')+await fs.readFile('migrations/0009_player_identity_wallets.sql','utf8');
const catalog=JSON.parse(await fs.readFile('games.json','utf8'));
function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys = ON;'+schema);t.after(()=>db.close());let requests=0;
  const wrap=statement=>{let values=[];return{bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async all(){return{results:statement.all(...values)};},async run(){return{meta:{changes:statement.run(...values).changes}};}};};
  const env={DB:{prepare:sql=>wrap(db.prepare(sql)),batch:async statements=>{const out=[];for(const s of statements)out.push(await s.run());return out;}}};
  const api=async(url,body)=>{
    const response=await worker.fetch(new Request('https://example.test'+url,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'content-type':'application/json','cf-connecting-ip':`192.0.2.${++requests}`}}),env);
    return {status:response.status,...await response.json()};
  };
  const results=new GameResults({},env);
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM leaderboard_entries').get().n;
  return {db,env,api,results,count};
}
const outcome=(overrides={})=>({slug:'huang',variant:'jensen',name:'AGENT TEST',playerId:'mc_fixture',result:'win',submissionId:'ABCD-1-0123abcd:jensen:mc_fixture',metadata:{matchId:'ABCD-1-0123abcd',reason:'escaped'},...overrides});

test('the huang catalog entry declares two server-posted win/loss record boards',()=>{
  const game=catalog.games.find(g=>g.slug==='huang');
  assert.deepEqual(game.leaderboard.boards.map(b=>[b.variant,b.label,b.aggregation,b.display,b.direction,b.submitter]),
    [['jensen','As Jensen','win-loss-rate','record','desc','server'],['hawks','As Hawks','win-loss-rate','record','desc','server']]);
  assert.deepEqual(game.tags,['political','multiplayer','funny']);
  assert.equal(game.featuredRank,undefined);
});

test('browsers cannot post to a server-submitted board',async t=>{
  const {api,count}=fixture(t);
  for(const variant of ['jensen','hawks']){
    const res=await api('/api/v1/leaderboard',{slug:'huang',variant,name:'Cheater',playerId:'mc_cheat',result:'win',submissionId:'cheat-'+variant+'-0001'});
    assert.equal(res.status,403,JSON.stringify(res));
  }
  assert.equal((await api('/api/leaderboard',{slug:'huang',variant:'jensen',name:'Cheater',playerId:'mc_cheat',result:'win'})).status,403);
  assert.equal(count(),0);
});

test('the game server posts outcomes through GameResults; the board shows the record',async t=>{
  const {api,results,count}=fixture(t);
  assert.deepEqual(await results.submitOutcome(outcome()),{ok:true,slug:'huang',variant:'jensen',submissionId:'ABCD-1-0123abcd:jensen:mc_fixture',duplicate:false});
  assert.equal((await results.submitOutcome(outcome({result:'loss',submissionId:'ABCD-2-0123abcd:jensen:mc_fixture'}))).ok,true);
  assert.equal((await results.submitOutcome(outcome({variant:'hawks',playerId:'mc_hawk',name:'HAWK',result:'loss',submissionId:'ABCD-1-0123abcd:hawks:mc_hawk'}))).ok,true);
  // a retry of the same match and player changes nothing
  assert.equal((await results.submitOutcome(outcome())).duplicate,true);
  assert.equal(count(),3);
  const jensen=await api('/api/v1/leaderboard?slug=huang&variant=jensen');
  assert.equal(jensen.status,200);
  assert.equal(jensen.board.display,'record');
  assert.deepEqual(jensen.entries.map(e=>[e.playerId,e.name,e.wins,e.losses,e.matches,e.score]),[['mc_fixture','AGENT TEST',1,1,2,50]]);
  const hawks=await api('/api/v1/leaderboard?slug=huang&variant=hawks');
  assert.deepEqual(hawks.entries.map(e=>[e.playerId,e.wins,e.losses]),[['mc_hawk',0,1]]);
});

test('GameResults refuses anything but a well-formed outcome for a server board',async t=>{
  const {results,count}=fixture(t);
  const bad=async o=>{const r=await results.submitOutcome(o);assert.equal(r.ok,false,JSON.stringify(r));};
  await bad(outcome({slug:'leave',variant:'dirt'}));
  await bad(outcome({variant:'solo'}));
  await bad(outcome({result:'forfeit'}));
  await bad(outcome({playerId:''}));
  await bad(outcome({name:''}));
  await bad(outcome({submissionId:'x'}));
  await bad(outcome({slug:'no-such-game'}));
  assert.equal(count(),0);
});

test('GameResults resolves a browser secret to its public player id',async t=>{
  const {results}=fixture(t);
  const secret='A'.repeat(43);
  const p=await results.player(secret);
  assert.match(p.playerId,/^mc_[A-Za-z0-9_-]{24}$/);
  assert.equal(p.signedIn,false);
  assert.deepEqual(await results.player(secret),p);
  assert.equal(await results.player('short'),null);
});
