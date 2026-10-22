import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {labGames,visibleLabGames} from '../src/lib/lab.js';
const catalog=JSON.parse(await fs.readFile('games.json','utf8'));
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'lab-catalog-test-'));
await build({entryPoints:['worker/index.js'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'worker.mjs'),logLevel:'silent'});
const {default:worker}=await import(path.join(temp,'worker.mjs'));
after(()=>fs.rm(temp,{recursive:true,force:true}));
const schema=await fs.readFile('migrations/0001_platform.sql','utf8');
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(schema);t.after(()=>db.close());
 const wrap=statement=>{let values=[];return{bind(...v){values=v;return this;},async first(){return statement.get(...values)||null;},async all(){return{results:statement.all(...values)};},async run(){return{meta:{changes:statement.run(...values).changes}};}};};
 const env={DB:{prepare:sql=>wrap(db.prepare(sql))},ASSETS:{fetch:()=>new Response('spa')}};
 const request=(url,init={})=>worker.fetch(new Request('https://mann.cool'+url,{redirect:'manual',...init,headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.92',...init.headers}}),env);
 return {db,request};
}
const lab=catalog.games.filter(game=>game.status==='lab');
test('lab games stay off the homepage list and link out over https',()=>{
 assert.ok(lab.length>0);
 for(const game of lab){assert.equal(game.featuredRank,undefined);assert.match(game.url,/^https:\/\//);}
});
test('lab games with tokens, points or payouts on their page are wallet-only',()=>{
 for(const slug of ['blue-or-red','clickstr','tttttttt'])assert.equal(lab.find(game=>game.slug===slug).crypto,true,slug);
 assert.deepEqual(visibleLabGames(catalog.games,false).filter(game=>game.crypto),[]);
 assert.deepEqual(visibleLabGames(catalog.games,null).filter(game=>game.crypto),[]);
});
test('crypto lab games come last, so cards already shown stay put when a wallet adds them',()=>{
 const games=[{slug:'a',status:'lab',catalogOrder:1},{slug:'b',status:'lab',crypto:true,catalogOrder:3},{slug:'c',status:'lab',catalogOrder:2},{slug:'d',status:'published',catalogOrder:4}];
 const slugs=list=>list.map(game=>game.slug);
 assert.deepEqual(slugs(labGames(games)),['c','a','b']);
 assert.deepEqual(slugs(visibleLabGames(games,null)),['c','a']);
 assert.deepEqual(slugs(visibleLabGames(games,false)),['c','a']);
 assert.deepEqual(slugs(visibleLabGames(games,true)),['c','a','b']);
 const all=labGames(catalog.games),firstCrypto=all.findIndex(game=>game.crypto);
 assert.ok(firstCrypto===-1||all.slice(firstCrypto).every(game=>game.crypto));
});
test('mann.cool/<lab slug> points at the game\'s own host, and /lab is the app',async t=>{
 const f=fixture(t);
 for(const game of lab.filter(entry=>entry.url))for(const suffix of ['','/']){
  const r=await f.request(`/${game.slug}${suffix}`);assert.equal(r.status,302);assert.equal(r.headers.get('location'),game.url);
 }
 assert.equal(await (await f.request('/lab')).text(),'spa');
});
test('the game shell config carries a game\'s song and source links',async t=>{
 const f=fixture(t);
 const config=async slug=>(await f.request(`/platform/config.json${slug?`?slug=${slug}`:''}`)).json();
 assert.equal((await config()).game,undefined);
 assert.equal((await config('not-a-game')).game,undefined);
 assert.deepEqual((await config('windows')).game,{songs:[{number:5679,url:'https://www.youtube.com/watch?v=XHFsSh5D68Y'}],sourceUrl:null});
 assert.deepEqual((await config('sledding')).game,{songs:[{number:1819,url:'https://www.youtube.com/watch?v=7VJ4vCEcTJk'}],sourceUrl:'https://github.com/songadaymann/sledding'});
 assert.deepEqual((await config('cyber')).game,{songs:[],sourceUrl:'https://github.com/songadaymann/cyber'});
});
test('a play for a lab game registers it as hidden, which D1 allows',async t=>{
 const f=fixture(t);
 const r=await f.request('/api/v1/plays',{method:'POST',body:JSON.stringify({slug:'blue-or-red',source:'direct'})});
 assert.equal(r.status,200);assert.equal((await r.json()).count,1);
 assert.equal(f.db.prepare('SELECT status FROM games WHERE slug=?').get('blue-or-red').status,'hidden');
});
