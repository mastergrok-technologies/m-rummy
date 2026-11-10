import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileGroups, remainingSeconds, tableStandings, presencePresentation } from '../public/board-state.js';
test('deadline recomputes after suspension and respects server clock offset', () => {
  assert.equal(remainingSeconds(61000, 1000, 1000), 59);
  assert.equal(remainingSeconds(61000, 1000, 59001), 1);
  assert.equal(remainingSeconds(61000, 1000, 120000), 0);
});
test('saved groups reject malformed data, duplicates and missing cards without merging physical copies', () => {
  const hand = [{ id: 'deck1-7H' }, { id: 'deck2-7H' }, { id: 'deck1-8H' }];
  assert.deepEqual(reconcileGroups({ ids: [] }, hand), []);
  const groups = reconcileGroups([null, { ids: 'bad' }, { ids: ['deck1-7H', 'deck1-7H', 'missing'], title: 'Old' }, { ids: ['deck1-7H', 'deck2-7H'] }], hand);
  assert.deepEqual(groups, [{ ids: ['deck1-7H'], title: 'Group' }, { ids: ['deck2-7H'], title: 'Group' }]);
});
test('standings preserve tied ranks and do not mutate player seat order', () => {
  const players = [{ name: 'Z', total: 30 }, { name: 'B', total: 10 }, { name: 'A', total: 10 }];
  assert.deepEqual(tableStandings(players).map(p => [p.name, p.place]), [['A', 1], ['B', 1], ['Z', 3]]);
  assert.equal(players[0].name, 'Z');
});

test('presence labels use an allowlist and fall back for absent or unexpected server values', () => {
  assert.deepEqual(presencePresentation('away'), { status: 'away', label: 'Away' });
  assert.deepEqual(presencePresentation('online'), { status: 'online', label: 'Connected' });
  for (const value of [undefined, null, '__proto__', '<script>', 'bad-status']) assert.equal(presencePresentation(value).status, 'unknown');
});

test('turn guidance follows draw, selection, forbidden open pick and real turn ownership', async () => {
  const { gameplayGuidance } = await import('../public/board-state.js');
  const room = { status:'playing',phase:'draw',me:'me',turn:'me',hand:[{id:'a',rank:7,suit:'H'},{id:'b',rank:1,suit:'S'}],players:[{id:'me',name:'Me'},{id:'other',name:'Friend'}] };
  assert.equal(gameplayGuidance(room,new Set()).step,'draw');
  room.phase='discard'; assert.equal(gameplayGuidance(room,new Set()).step,'select');
  assert.equal(gameplayGuidance(room,new Set(['a','b'])).canDiscard,false);
  assert.equal(gameplayGuidance(room,new Set(['a'])).canDiscard,true);
  assert.match(gameplayGuidance(room,new Set(['a'])).title,/7 of hearts/);
  room.drawnOpen='a'; assert.equal(gameplayGuidance(room,new Set(['a'])).step,'blocked');
  assert.equal(gameplayGuidance(room,new Set(['a'])).canDiscard,false);
  assert.equal(gameplayGuidance(room,new Set(['b','missing'])).canDiscard,true);
  room.turn='other'; assert.equal(gameplayGuidance(room,new Set(['b'])).step,'waiting');
  room.players[0].dropped=true; assert.equal(gameplayGuidance(room,new Set(['b'])).step,'watching');
  room.status='finished'; assert.equal(gameplayGuidance(room,new Set()).step,'finished');
});

test('local arrangement snapshots are independent and tied to physical hand IDs', async () => {
  const { handIdentity, arrangementSnapshot } = await import('../public/board-state.js');
  const hand=[{id:'deck1-7H'},{id:'deck2-7H'}], groups=[{ids:['deck1-7H'],title:'Group'}];
  const snapshot=arrangementSnapshot(groups,new Set(['deck1-7H','missing']),hand);
  groups[0].ids.push('deck2-7H');
  assert.deepEqual(snapshot.groups,[{ids:['deck1-7H'],title:'Group'}]);
  assert.deepEqual(snapshot.selected,['deck1-7H']);
  assert.equal(snapshot.handKey,handIdentity([...hand].reverse()));
  assert.notEqual(snapshot.handKey,handIdentity([hand[0]]));
});

test('recent chat attention tracks message IDs, sender identity and retained history only',async()=>{
  const {recentChatState}=await import('../public/board-state.js');
  const messages=[{id:'old',playerId:'other',name:'Me'}];
  const baseline=recentChatState(null,messages,'me'); assert.deepEqual(baseline.unread,[]);
  const next=recentChatState(baseline,[...messages,{id:'mine',playerId:'me'},{id:'new',playerId:'other',name:'Me'}],'me');
  assert.deepEqual(next.unread,['new']); assert.deepEqual(baseline.unread,[]);
  assert.deepEqual(recentChatState(next,[{id:'new',playerId:'other'}],'me').unread,['new']);
  assert.deepEqual(recentChatState(next,[{id:'mine',playerId:'me'}],'me').unread,[]);
  assert.deepEqual(recentChatState(next,[{id:'new',playerId:'other'}],'me',true).unread,[]);
});

test('round outcome requires server settlement and separates winner, penalties and profile reward',async()=>{
  const {roundOutcome}=await import('../public/board-state.js');
  const state={status:'playing',me:'me',result:{winner:'other',scores:[{id:'me',penalty:20,total:40,dropped:true}],pointsAward:{winner:'other',eligible:true,amount:100}}};
  assert.equal(roundOutcome(state),null);
  state.status='finished'; assert.deepEqual(roundOutcome(state),{won:false,dropped:true,penalty:20,total:40,reward:0});
  state.result.winner='me';state.result.pointsAward.winner='me';assert.equal(roundOutcome(state).reward,100);
  state.result.pointsAward.eligible=false;assert.equal(roundOutcome(state).reward,0);
  state.result.scores=[];assert.equal(roundOutcome(state).penalty,null);
});
