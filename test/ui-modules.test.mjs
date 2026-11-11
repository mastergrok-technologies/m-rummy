import { lastDealPanelMarkup } from '../public/ui/panels/last-deal.js';
import { bestDeclarationPanelMarkup, declarationPanelMarkup } from '../public/ui/panels/declaration.js';
import { handPanelMarkup } from '../public/ui/panels/hand.js';
import { standingsPanelMarkup } from '../public/ui/panels/standings.js';
import { chatPanelMarkup } from '../public/ui/panels/chat.js';
import { informationPanelMarkup } from '../public/ui/panels/information.js';
import { settingsPanelMarkup } from '../public/ui/panels/settings.js';
import { gameplayMarkup } from '../public/ui/gameplay.js';
import { waitingRoomMarkup } from '../public/ui/waiting-room.js';
import { profileMarkup } from '../public/ui/profile.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFormMarkup } from '../public/ui/account.js';
import { joinedTablesMarkup, tablePickerMarkup } from '../public/ui/tables.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

test('account forms preserve separate registration and login requirements', () => {
  const register = accountFormMarkup(true);
  const login = accountFormMarkup(false);
  assert.match(register, /id="account-confirm"/);
  assert.match(register, /autocomplete="new-password"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.doesNotMatch(login, /id="account-confirm"/);
  assert.match(login, /id="auth-form"/);
});

test('table switcher marks active and urgent tables and escapes room codes', () => {
  const html = joinedTablesMarkup([{ code: 'ABC123', yourTurn: true }, { code: '<script>', yourTurn: false }], 'ABC123', 3, esc);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /Your turn/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Add table \(2\/3\)/);
});

test('table picker includes live connection notice and table count', () => {
  const html = tablePickerMarkup(2, 3, '<div role="status">Connected</div>');
  assert.match(html, /2 of 3 available tables/);
  assert.match(html, /role="status"/);
});


test('profile view shows player stats and safely escapes identity', () => {
  const profile = { name: '<Alice>', username: 'alice', points: 10100, wins: 2, roundsPlayed: 4, historyTotal: 1, history: [{ type: 'signup', time: '2026-11-01T10:00:00Z', amount: 10000, balance: 10000 }] };
  const html = profileMarkup(profile, 0, esc, n => Number(n).toLocaleString('en-US'));
  assert.match(html, /&lt;Alice>/);
  assert.doesNotMatch(html, /<Alice>/);
  assert.match(html, /Points history/);
  assert.match(html, /Welcome bonus/);
  assert.match(html, /data-history="0" disabled/);
  assert.match(html, /id="sign-out"/);
});

test('profile history renders page offsets and escapes room names', () => {
  const profile = { name: 'Alice', username: 'alice', points: 10000, wins: 0, roundsPlayed: 0, historyTotal: 42, history: [{ type: 'win', round: 3, time: '2026-11-01T10:00:00Z', room: '<room>', amount: 50, balance: 10050 }] };
  const html = profileMarkup(profile, 20, esc, String);
  assert.match(html, /data-history="0"/);
  assert.match(html, /data-history="40"/);
  assert.match(html, /&lt;room>/);
  assert.doesNotMatch(html, /<room>/);
});


test('waiting room keeps host deal guarded until two players are seated', () => {
  const base = { me: 'me', host: 'me', code: 'ABC123', hasPassword: false, players: [{ id: 'me', name: 'Me' }], messages: [] };
  const avatar = () => 'M';
  const one = waitingRoomMarkup(base, '', '<header>Room</header>', esc, avatar);
  assert.match(one, /Deal the first round[^<]*<span aria-hidden="true">/);
  assert.match(one, /data-action="start" aria-describedby="waiting-help" disabled/);
  assert.match(one, /Invite a friend to seat 2/);
  assert.match(one, /<header>Room<\/header>/);
  const two = waitingRoomMarkup({ ...base, players: [...base.players, { id: 'friend', name: 'Friend' }] }, '', '', esc, avatar);
  assert.match(two, /data-action="start" aria-describedby="waiting-help" >/);
});

test('waiting room hides host controls from guests and escapes player messages', () => {
  const state = { me: 'guest', host: 'host', code: 'ROOM42', hasPassword: true, players: [{ id: 'host', name: '<Host>' }, { id: 'guest', name: 'Guest' }], messages: [{ name: '<Eve>', text: '<script>alert(1)</script>', time: '2026-11-01T10:00:00Z' }] };
  const html = waitingRoomMarkup(state, '<draft>', '', esc, () => 'A');
  assert.doesNotMatch(html, /data-action="start"/);
  assert.doesNotMatch(html, /data-action="addBot"/);
  assert.match(html, /&lt;Host>/);
  assert.match(html, /&lt;script>alert\(1\)&lt;\/script>/);
  assert.match(html, /value="&lt;draft>"/);
  assert.match(html, /Share its password separately/);
});


const gameplayHelpers = {
  esc,
  number: String,
  card: c => `<span class="card">${c?.id || ''}</span>`,
  seatAvatar: () => 'A',
  turnText: () => 'Your turn',
  ranks: { 5: '5' }
};
const gameplayState = () => ({
  status: 'playing', phase: 'draw', me: 'me', host: 'me', turn: 'me', code: 'ABC123', round: 1,
  hand: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, rank: i + 1, suit: 'H' })),
  players: [{ id: 'me', name: 'Me', total: 0, turns: 0, count: 13 }, { id: 'friend', name: '<Friend>', total: 5, count: 13 }],
  indicator: { id: 'joker', rank: 5, suit: 'C' }, wildRank: 5, stockCount: 70,
  topDiscard: { id: 'discard', rank: 7, suit: 'S' }, messages: [], activity: [], history: []
});

test('gameplay renderer keeps turn controls, cards and safe player names', () => {
  const html = gameplayMarkup(gameplayState(), [], new Set(), '', '', gameplayHelpers);
  assert.match(html, /Draw from closed deck/);
  assert.match(html, /Your hand/);
  assert.match(html, /data-action="discard" disabled/);
  assert.match(html, /&lt;Friend>/);
  assert.doesNotMatch(html, /<Friend>/);
});

test('gameplay renderer shows completed round scores and rematch controls', () => {
  const state = gameplayState();
  state.status = 'finished';
  state.result = { reason: 'last-player', winner: 'me', winnerName: 'Me', scores: [{ id: 'me', name: 'Me', penalty: 0, total: 0 }], groups: [] };
  const html = gameplayMarkup(state, [], new Set(), '', '', gameplayHelpers);
  assert.match(html, /Round results and player penalties/);
  assert.match(html, /Deal another round/);
  assert.match(html, /Me wins/);
});


test('chat panel renders private messages safely and keeps draft', () => {
  const state = { code: 'ABC', players: [{ id: 'me' }], messages: [{ name: '<Alice>', text: '<script>alert(1)</script>', time: '2026-11-01T10:00:00Z' }] };
  const html = chatPanelMarkup(state, 'hello', 'replies', false, 'connected', { esc, chatEmojis: [], chatReplies: ['Hi'] });
  assert.match(html, /&lt;Alice>/);
  assert.match(html, /&lt;script>alert\(1\)&lt;\/script>/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.match(html, /value="hello"/);
  assert.match(html, /Table message history/);
});

test('information panel describes rules and room safely', () => {
  const state = { code: '<room>', players: [{ id: 'me' }], status: 'playing', round: 2, hasPassword: true };
  const html = informationPanelMarkup(state, { esc, number: String });
  assert.match(html, /&lt;room>/);
  assert.match(html, /Password protected/);
  assert.match(html, /A valid declaration/);
});

test('settings panel reflects available last deal and local preferences', () => {
  const state = { code: 'ABC' };
  const html = settingsPanelMarkup(state, false, { roomyCards: true, quietMotion: false }, 'Saved', { esc });
  assert.match(html, /data-settings-panel="lastDeal"/);
  assert.match(html, /data-preference="roomyCards"[^>]*checked/);
  assert.match(html, /Saved/);
});


test('hand panel renders empty hand without exposing opponents cards', () => {
  const state = { code: 'ABC', round: 1, hand: [], me: 'me', players: [{ id: 'me', name: 'Me' }], status: 'playing', wildRank: null };
  const html = handPanelMarkup(state, [], { esc, number: String, card: () => '', ranks: {} });
  assert.match(html, /No cards in your hand/);
  assert.match(html, /Your arranged hand/);
  assert.match(html, /Return to table/);
});

test('standings panel shows ranked players without leaking cards mid-round', () => {
  const state = { code: 'ABC', me: 'me', status: 'playing', round: 1, wildRank: null, players: [{ id: 'me', name: 'Me', total: 0 }, { id: 'other', name: '<Friend>', total: 20 }] };
  const html = standingsPanelMarkup(state, false, { esc, number: String, card: () => '', seatAvatar: () => 'A', ranks: {} });
  assert.match(html, /Cumulative table penalties/);
  assert.match(html, /&lt;Friend>/);
  assert.match(html, /only after the round ends/);
});


test('last-deal panel shows an empty state before the first completed round', () => {
  assert.match(lastDealPanelMarkup(undefined, { esc, number: String }), /No completed round is available yet/);
});

test('last-deal panel escapes names and displays server-recorded penalties', () => {
  const lastDeal = { round: 2, winner: '<Alice>', scores: [{ name: '<Bob>', penalty: 20, total: 40 }] };
  const html = lastDealPanelMarkup(lastDeal, { esc, number: String });
  assert.match(html, /&lt;Alice>/);
  assert.match(html, /&lt;Bob>/);
  assert.match(html, /Last completed round penalties/);
  assert.doesNotMatch(html, /<Bob>/);
});

test('declaration guidance disables auto-group while reconnecting', () => {
  const html = bestDeclarationPanelMarkup(false, 'reconnecting');
  assert.match(html, /data-panel-action="arrange" disabled/);
  assert.match(html, /not a guaranteed winning declaration/);
});

test('declaration retry escapes server error and preserves review action', () => {
  const html = declarationPanelMarkup('<Invalid cards>', false, 'connected', esc);
  assert.match(html, /&lt;Invalid cards>/);
  assert.match(html, /Review cards &amp; retry/);
  assert.match(html, /data-panel="bestDeclaration"/);
});

test('home renders private tables, escapes identity and exposes the membership limit', async () => {
  const { homeMarkup } = await import('../public/ui/home.js');
  const html = homeMarkup({ name: '<script>', points: 10000 }, [{ code: '<room>', playerCount: 2, status: 'playing', yourTurn: true }], 1, 'joined', esc, String);
  assert.match(html, /&lt;script>/);
  assert.match(html, /&lt;room>/);
  assert.doesNotMatch(html, /<script>|<room>/);
  assert.match(html, /Your turn/);
  assert.match(html, /data-home-entry="create" disabled/);
  assert.match(html, /data-home-entry="join" disabled/);
  assert.match(html, /data-home-tab="joined" aria-current="page"/);
  assert.doesNotMatch(html, /₹|Entry amount|deposit|cash prize/i);
});

test('home covers waiting, watching, completed and empty memberships', async () => {
  const { homeMarkup, homeTablesMarkup } = await import('../public/ui/home.js');
  const empty = homeMarkup({ name: 'Me', points: 10000 }, [], 3, 'points', esc, String);
  assert.match(empty, /No tables joined yet/);
  assert.match(empty, /data-home-entry="create" >/);
  assert.match(empty, /data-home-tab="points" aria-current="page"/);
  const html = homeTablesMarkup([{code: 'A', status: 'lobby', playerCount: 2}, {code: 'B', status: 'playing', dropped: true, playerCount: 6}, {code: 'C', status: 'finished', playerCount: 3}], esc);
  for (const label of ['Waiting for players', 'Watching', 'Round complete']) assert.ok(html.includes(label));
});

test('profile avatars use a strict local asset allowlist', async () => {
  const { avatarSource } = await import('../public/ui/avatars.js');
  for (const bad of [null, 0, 6, '2', '../other', '<img>', 1.1]) assert.equal(avatarSource(bad), null);
  assert.equal(avatarSource(3), '/assets/figma/avatar-3.svg');
  const html = profileMarkup({name: 'Me', username: 'me', avatar: 3, points:10000, wins:0, roundsPlayed:0, history:[], historyTotal:0}, 0, esc, String);
  assert.match(html, /value="3" checked/);
  assert.match(html, /0–0 of 0/);
  assert.match(html, /No activity in this category/);
});

test('profile history escapes saved match details and keeps filtered pagination', () => {
  const html = profileMarkup({name:'Me',username:'me',points:10100,wins:1,roundsPlayed:2,historyFilter:'win',historyTotal:21,history:[{type:'win',round:2,room:'<room>',time:0,amount:100,balance:10100,opponents:1,match:{winner:'<winner>',penalty:0,totalPenalty:20,reason:'last-player'}}]}, 20, esc, String);
  assert.match(html, /&lt;winner>/);
  assert.match(html, /&lt;room>/);
  assert.doesNotMatch(html, /<winner>|<room>/);
  assert.match(html, /Last player standing/);
  assert.match(html, /data-history-filter="win" aria-current="page"/);
  assert.match(html, /21–21 of 21/);
});

test('username page escapes current handle and requires a fresh current password', async () => {
  const { accountPageMarkup } = await import('../public/ui/account-pages.js');
  const html = accountPageMarkup('username', { username:'<bad>' }, esc);
  assert.match(html, /&lt;bad>/); assert.doesNotMatch(html, /<bad>/);
  assert.match(html, /type="password" autocomplete="current-password"/);
  assert.doesNotMatch(html, /name="currentPassword"[^>]*value=/);
  assert.match(html, /Save username/);
});

test('suggestion and receipt views escape draft/result text and expose actual server receipt', async () => {
  const { accountPageMarkup } = await import('../public/ui/account-pages.js');
  const form = accountPageMarkup('feedback', {draft:{message:'<script>',category:'idea'},lastId:'receipt'}, esc);
  assert.match(form, /&lt;script>/); assert.match(form, /maxlength="1000"/); assert.match(form, /View last submission/);
  const html = accountPageMarkup('feedback-receipt', {receipt:{id:'abc',message:'<script>alert(1)</script>',category:'idea',time:0}}, esc);
  assert.match(html, /Reference/); assert.match(html, /Your suggestion is saved/);
  assert.doesNotMatch(html, /<script\b/); assert.match(html, /for the host to review/);
});

test('gameplay guidance exposes selection recovery and blocks the just-picked open card', () => {
  const state=gameplayState(); state.phase='discard'; state.drawnOpen='c0';
  const blocked=gameplayMarkup(state,[],new Set(['c0']),'','',{...gameplayHelpers,canUndo:true});
  assert.match(blocked,/Choose a different discard/);
  assert.match(blocked,/data-action="discard" disabled/);
  assert.match(blocked,/data-action="declare" disabled/);
  assert.match(blocked,/data-action="undo-arrangement" >/);
  assert.match(blocked,/data-action="clear-selection" >/);
  const ready=gameplayMarkup(state,[],new Set(['c1']),'','',gameplayHelpers);
  assert.match(ready,/data-action="discard" >/);
  assert.match(ready,/2 of hearts/);
  assert.match(ready,/Seconds remaining in your turn/);
  state.turn='friend'; state.players[1].name='<script>alert(1)</script>';
  const waiting=gameplayMarkup(state,[],new Set(),'','',gameplayHelpers);
  assert.match(waiting,/&lt;script>alert/); assert.doesNotMatch(waiting,/<script\b/);
});

test('joined table filters prioritize turns while preserving stable table numbers',async()=>{
  const {homeTablesMarkup,homeAttentionMarkup}=await import('../public/ui/home.js');
  const tables=[{code:'WAIT',status:'lobby',playerCount:2},{code:'PLAY',status:'playing',yourTurn:true,playerCount:3}];
  const all=homeTablesMarkup(tables,esc);assert.ok(all.indexOf('Table 2')<all.indexOf('Table 1'));
  const waiting=homeTablesMarkup(tables,esc,'lobby');assert.match(waiting,/WAIT/);assert.doesNotMatch(waiting,/PLAY/);
  assert.match(homeTablesMarkup(tables,esc,'finished'),/No tables match/);
  assert.match(homeAttentionMarkup(tables,esc),/data-attention-table="PLAY"/);
});

test('round results show own settled outcome and guard next-round actions',async()=>{
  const {roundResultsMarkup}=await import('../public/ui/round-results.js');
  const state=gameplayState();state.result={winner:'me',winnerName:'<Winner>',reason:'last-player',groups:[],scores:[{id:'me',name:'Me',penalty:0,total:30}],pointsAward:{winner:'me',eligible:true,amount:100}};
  assert.equal(roundResultsMarkup(state,gameplayHelpers),'');
  state.status='finished';const html=roundResultsMarkup(state,gameplayHelpers);
  assert.match(html,/Your round penalty/);assert.match(html,/Profile points earned/);assert.match(html,/&lt;Winner>/);assert.doesNotMatch(html,/<Winner>/);
  state.players=[state.players[0]];assert.match(roundResultsMarkup(state,gameplayHelpers),/data-action="start" disabled/);
  state.host='other';assert.doesNotMatch(roundResultsMarkup(state,gameplayHelpers),/data-action="start"/);
});

test('tutorial topics cover all steps and practice feedback stays independent of live cards', async () => {
  const {tutorialTopicsMarkup,tutorialPracticeMarkup}=await import('../public/ui/tutorial.js');
  const {tutorialSteps,tutorialQuestions}=await import('../public/tutorial.js');
  assert.equal(tutorialQuestions.length,tutorialSteps.length);
  for (let i=0;i<tutorialSteps.length;i++) {
    const topics=tutorialTopicsMarkup(i,esc);
    assert.equal((topics.match(/aria-current="step"/g)||[]).length,1);
    assert.match(topics,new RegExp(`data-tutorial-topic="${i}" aria-current="step"`));
    assert.match(tutorialPracticeMarkup(i,undefined,esc),/Choose an answer/);
    assert.match(tutorialPracticeMarkup(i,tutorialQuestions[i].correct,esc),/Correct\./);
    assert.match(tutorialPracticeMarkup(i,1-tutorialQuestions[i].correct,esc),/Try another answer/);
    assert.doesNotMatch(tutorialPracticeMarkup(i,0,esc),/data-card=|data-action=|data-panel-action=/);
  }
});

test('declaration recovery follows turn, drop and round transitions without validating groups',async()=>{
  const {declarationStatus}=await import('../public/ui/panels/declaration.js');
  const state={status:'playing',phase:'draw',me:'me',turn:'me',hand:Array.from({length:13},(_,i)=>({id:`c${i}`,rank:2,suit:'H'})),players:[{id:'me',name:'Me'},{id:'other',name:'<Friend>'}]};
  assert.match(declarationStatus(state),/Draw one card/);
  state.phase='discard';state.hand.push({id:'drawn',rank:3,suit:'S'});state.drawnOpen='drawn';
  assert.match(declarationStatus(state,new Set(['drawn'])),/different discard/);
  assert.match(declarationStatus(state,new Set(['c0'])),/Selected:/);
  state.turn='other';assert.match(declarationStatus(state),/another player/);
  state.players[0].dropped=true;assert.match(declarationStatus(state),/watching/);
  state.status='finished';assert.match(declarationStatus(state),/not active/);
  assert.match(declarationStatus(state,new Set(),false,'reconnecting'),/fresh snapshot/);
  assert.match(declarationStatus(state,new Set(),true),/confirm/);
  assert.match(bestDeclarationPanelMarkup(false,'connected',state),/data-panel-action="arrange" disabled/);
  const html=declarationPanelMarkup('<bad>',false,'connected',esc,state);
  assert.doesNotMatch(html,/Your turn is still active/);assert.match(html,/&lt;bad>/);assert.match(html,/data-declaration-review/);
});

test('last-deal browsing exposes only recorded history and keeps historical totals explicit',()=>{
  const history=[{round:3,winner:'<Alice>',scores:[{name:'Same',penalty:0,total:80},{name:'Same',penalty:20,total:40}]},{round:2,winner:'Bob',scores:[{name:'Bob',penalty:0,total:20}]}];
  const html=lastDealPanelMarkup(history[1],{esc,number:String},history);
  assert.match(html,/value="2" selected/);assert.match(html,/1 newer completed round is available/);
  assert.match(html,/id="last-deal-older" data-deal-round="" disabled/);
  assert.match(html,/id="last-deal-newer" data-deal-round="3"/);
  assert.match(html,/Totals reflect that point in time/);assert.doesNotMatch(html,/data-card|You<|winner-row/);
  const latest=lastDealPanelMarkup(history[0],{esc,number:String},history);
  assert.match(latest,/&lt;Alice>/);assert.match(latest,/id="last-deal-newer" data-deal-round="" disabled/);
  assert.match(latest,/Showing the latest completed round/);
});

test('account forms expose keyboard tabs and password controls without rendering secrets',async()=>{
  const {accountValidation}=await import('../public/ui/account.js');
  const register=accountFormMarkup(true),login=accountFormMarkup(false);
  assert.match(register,/id="account-register-tab"[^>]*tabindex="0"/);
  assert.match(login,/id="account-login-tab"[^>]*tabindex="0"/);
  assert.match(register,/role="tabpanel" aria-labelledby="account-register-tab"/);
  assert.match(register,/data-password-toggle="account-confirm"/);
  assert.doesNotMatch(login,/account-confirm|Passwords match/);
  assert.match(login,/id="auth-error"[^>]*role="alert"/);
  assert.equal(accountValidation({password:'long-secret-123',confirmPassword:'long-secret-123'},true),null);
  assert.equal(accountValidation({password:'long-secret-123',confirmPassword:'different-123'},true).field,'account-confirm');
  assert.equal(accountValidation({password:'🂡'.repeat(33)},false).field,'account-password');
  assert.equal(accountValidation({password:'a'.repeat(128)},false),null);
});

test('invite codes accept same-site links and reject unrelated or malformed URLs',async()=>{
  const {inviteCode}=await import('../public/ui/invite.js');
  const origin='https://rummy.example';
  assert.equal(inviteCode(' abcdef123456 ',origin),'ABCDEF123456');
  assert.equal(inviteCode(`${origin}/?room=abcdef123456&password=ignored`,origin),'ABCDEF123456');
  for(const value of ['', 'short','abcdef12345g','https://other.example/?room=abcdef123456',`${origin}/other?room=abcdef123456`,'javascript:alert(1)','https://user:secret@rummy.example/?room=abcdef123456','//rummy.example/?room=abcdef123456']) assert.equal(inviteCode(value,origin),'',value);
});

test('table setup and invite summaries disclose access without revealing passwords',async()=>{
  const {setupSummary,inviteMarkup}=await import('../public/ui/table-flows.js');
  assert.match(setupSummary(true),/separately/);assert.match(setupSummary(false),/Anyone with the link/);
  const html=inviteMarkup({code:'ABCDEF123456',players:[],hasPassword:true},'https://rummy.test',esc);
  assert.match(html,/id="invite-code-value" readonly value="ABCDEF123456"/);
  assert.match(html,/https:\/\/rummy.test\/\?room=ABCDEF123456/);assert.doesNotMatch(html,/password=/);
  assert.match(inviteMarkup({code:'<bad>'},'https://rummy.test',esc),/&lt;bad>/);
});

test('confirmation snapshots reject changed turns and penalties but tolerate chat updates',async()=>{
  const {confirmationIntent,confirmationProblem,confirmationDetails}=await import('../public/ui/table-flows.js');
  const state={code:'ABCDEF123456',round:1,status:'playing',me:'me',turn:'me',phase:'discard',deadline:1234,hand:[{id:'a',rank:3,suit:'S'}],players:[{id:'me',turns:0}]};
  const declare=confirmationIntent(state,'declare','a');assert.equal(confirmationProblem(declare,state),'');
  assert.equal(confirmationProblem(declare,{...state,version:99,messages:[{text:'new'}]}),'');
  for(const patch of [{deadline:5555},{turn:'other'},{round:2},{hand:[]},{drawnOpen:'a'},{status:'finished'},{code:'BBBBBB123456'}])assert.notEqual(confirmationProblem(declare,{...state,...patch}),'');
  const drawing={...state,phase:'draw'},drop=confirmationIntent(drawing,'drop');assert.equal(confirmationProblem(drop,drawing),'');
  assert.notEqual(confirmationProblem(drop,{...drawing,players:[{id:'me',turns:1}]}),'');
  assert.notEqual(confirmationProblem(drop,state),'');
  const lobby={...state,status:'lobby'},leave=confirmationIntent(lobby,'leave');assert.equal(confirmationProblem(leave,lobby),'');assert.notEqual(confirmationProblem(leave,state),'');
  assert.match(confirmationDetails(drawing,'drop',null,esc),/20 penalty points/);assert.match(confirmationDetails(lobby,'leave',null,esc),/other joined tables remain/);
});

test('private hand filters count jokers and preserve physical groups without exposing other hands',async()=>{
  const {handMatchesFilter}=await import('../public/ui/panels/hand.js');
  const state={code:'ABCDEF123456',round:1,status:'playing',me:'me',wildRank:5,players:[{id:'me'},{id:'other',hand:[{id:'secret',rank:7,suit:'C'}]}],hand:[{id:'a',rank:5,suit:'H'},{id:'b',rank:0,suit:'J'},{id:'c',rank:2,suit:'S'}]};
  const groups=[{title:'Saved group',ids:['a','c','stale']}],original=structuredClone(groups);
  const helpers={esc,number:String,ranks:{5:'5'},card:card=>`<i data-face="${card.id}"></i>`};
  assert.equal(handMatchesFilter(state.hand[0],'jokers',5),true);assert.equal(handMatchesFilter(state.hand[1],'jokers',5),true);assert.equal(handMatchesFilter(state.hand[2],'jokers',5),false);
  const html=handPanelMarkup(state,groups,helpers,'jokers');
  assert.match(html,/Showing 2 of 3 cards/);assert.match(html,/data-face="a"/);assert.match(html,/data-face="b"/);assert.doesNotMatch(html,/data-face="c"|secret|stale/);assert.deepEqual(groups,original);
  assert.match(handPanelMarkup(state,groups,helpers,'D'),/No cards match this filter/);
  assert.match(handPanelMarkup(state,groups,helpers,'unknown'),/Showing 3 of 3 cards/);
});

test('information topics explain server-supported joker and drop choices without private cards',()=>{
  const state={code:'<room>',round:1,status:'playing',players:[{id:'me'}],hasPassword:true,hand:[{id:'private-card'}]};
  const html=informationPanelMarkup(state,{esc,number:String});
  assert.match(html,/data-info-topic="info-jokers-title"/);assert.match(html,/Discard before dropping/);assert.match(html,/printed cut joker makes aces wild/);assert.doesNotMatch(html,/private-card|<room>/);
});

test('offline recovery preserves only a valid room code and never an arbitrary destination',async()=>{
  const {recoveryPath}=await import('../public/offline.js');
  assert.equal(recoveryPath('?room=abcdef123456&next=https://evil.test&password=secret'),'/?room=ABCDEF123456');
  for(const search of ['', '?room=invalid','?next=https://evil.test','?room=%3Cscript%3E'])assert.equal(recoveryPath(search),'/');
});

test('offline service worker caches recovery assets but never API responses or hands',async()=>{
  const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
  const handlers={},added=[],matched=[];
  runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{URL,self:{location:{origin:'https://rummy.test'},addEventListener:(name,callback)=>{handlers[name]=callback;}},caches:{open:async()=>({addAll:async paths=>added.push(...paths)}),match:async path=>{matched.push(path);return 'offline';}},fetch:async()=>{throw new Error('offline');}});
  let ready;handlers.install({waitUntil:promise=>{ready=promise;}});await ready;
  assert.deepEqual(added,['/offline.html','/offline.js','/style.css','/design-system.css']);
  let response;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://rummy.test/?room=ABCDEF123456'},respondWith:promise=>{response=promise;}});assert.equal(await response,'offline');
  for(const [method,url] of [['GET','https://rummy.test/api/tables'],['POST','https://rummy.test/api/action'],['GET','https://other.test/offline.js']])handlers.fetch({request:{method,mode:'cors',url},respondWith:()=>{assert.fail('Non-recovery request must use the network');}});
  assert.deepEqual(matched,['/offline.html']);
});

test('shared design text and action tokens meet normal-text contrast requirements',async()=>{
  const {readFile}=await import('node:fs/promises');
  const css=await readFile(new URL('../public/design-system.css',import.meta.url),'utf8');
  const tokens=Object.fromEntries([...css.matchAll(/(--ui-[a-z-]+):\s*(#[0-9a-f]{6});/g)].map(match=>[match[1],match[2]]));
  const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);};
  for(const [fg,bg] of [['--ui-text','--ui-surface'],['--ui-muted','--ui-surface'],['--ui-muted','--ui-surface-soft'],['--ui-on-primary','--ui-primary'],['--ui-danger','--ui-danger-soft'],['--ui-disabled-text','--ui-disabled']])assert.ok(contrast(tokens[fg],tokens[bg])>=4.5,`${fg} on ${bg}`);
  assert.ok(contrast(tokens['--ui-focus'],tokens['--ui-surface'])>=3);
});

test('main and offline entry points load the shared design after screen geometry',async()=>{
  const {readFile}=await import('node:fs/promises');
  for(const page of ['index.html','offline.html']){
    const html=await readFile(new URL(`../public/${page}`,import.meta.url),'utf8');
    assert.ok(html.indexOf('href="/design-system.css"')>html.indexOf('href="/style.css"'));
  }
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/class="skip-link" href="#app"/);assert.match(html,/<main id="app" tabindex="-1"/);
});
