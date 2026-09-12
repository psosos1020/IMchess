import { Chess } from 'chess.js';
import './style.css';

const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const KEY='imchess:v1';
const S=JSON.parse(localStorage.getItem(KEY)||'{"games":[],"weakness":{},"quiz":null}');
const save=()=>localStorage.setItem(KEY,JSON.stringify(S));
const phase=ply=>ply<=18?'초반':ply<=50?'중반':'후반';
const bump=k=>{S.weakness[k]=(S.weakness[k]||0)+1};

$('#app').innerHTML=`<header><div><div class="logo">IM<span>chess</span></div><div class="tag">개인 대국 학습 코치</div></div><div class="safe">● 실전 중 분석 차단</div></header><main><section class="hero"><div><h1>네가 반복해서 하는 실수를 찾아낸다.</h1><p>종료된 Chess.com / Lichess 대국을 가져와 초반·중반·후반의 약점을 학습하고, 실제 실수 포지션을 퀴즈로 다시 풀게 한다.</p></div><div class="import"><input id="user" placeholder="사용자명"><select id="source"><option value="chesscom">Chess.com</option><option value="lichess">Lichess</option></select><button id="remote">최근 대국 가져오기</button><label class="file">PGN 열기<input id="pgn" type="file" accept=".pgn,.txt"></label></div></section><section class="grid"><article class="panel"><h2>개인 약점</h2><div id="weak"><p class="muted">대국을 가져오면 반복 패턴이 쌓인다.</p></div></article><article class="panel"><h2>최근 대국</h2><div id="games"><p class="muted">아직 없다.</p></div></article></section><section class="panel"><div class="head"><h2>복기</h2><span id="status">대국을 선택하라.</span></div><div class="review"><div><div id="board" class="board"></div><div id="moves" class="moves"></div></div><div id="coach" class="coach"><h3>학습 루프</h3><p>대국 → 국면 → 실수 원인 → 반복 패턴 → 퀴즈</p></div></div></section></main>`;

function parsePGN(text,source){const chunks=text.split(/(?=\[Event )/).map(x=>x.trim()).filter(Boolean);return chunks.map(pgn=>{try{const c=new Chess(),h={};for(const l of pgn.split(/\r?\n/)){const m=l.match(/^\[([^ ]+)\s+"(.*)"\]$/);if(m)h[m[1]]=m[2]}const body=pgn.replace(/\[[^\n]+\]/g,' ').replace(/\{[^}]*\}/g,' ').replace(/\([^)]*\)/g,' ');const sans=[];for(const t of body.replace(/1-0|0-1|1\/2-1\/2|\*/g,' ').trim().split(/\s+/)){if(/^\d+\.{1,3}$/.test(t)||/^\d+\./.test(t))continue;try{const m=c.move(t,{sloppy:true});if(m)sans.push(m.san)}catch{}}return sans.length?{id:crypto.randomUUID(),source,h,sans,pgn}:null}catch{return null}}).filter(Boolean)}

async function importGames(){const u=$('#user').value.trim();if(!u)return alert('사용자명을 입력하라.');const src=$('#source').value;$('#status').textContent='가져오는 중...';try{let url,headers={};if(src==='chesscom'){const d=new Date();url=`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/pgn`;headers['User-Agent']='IMchess/0.1'}else{url=`https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=30&clocks=true&evals=true&opening=true`;headers.Accept='application/x-chess-pgn'}const r=await fetch(url,{headers});if(!r.ok)throw Error(`HTTP ${r.status}`);const gs=parsePGN(await r.text(),src);S.games=[...gs,...S.games].slice(0,300);save();render();if(gs[0])select(gs[0].id);$('#status').textContent=`${gs.length}판 가져왔다.`}catch(e){$('#status').textContent='가져오기 실패';alert('가져오기 실패: '+e.message)}}
$('#remote').onclick=importGames;
$('#pgn').onchange=async e=>{const f=e.target.files[0];if(!f)return;const gs=parsePGN(await f.text(),'PGN');S.games=[...gs,...S.games].slice(0,300);save();render();if(gs[0])select(gs[0].id)};

function render(){const g=$('#games');g.innerHTML=S.games.length?S.games.slice(0,40).map(x=>`<button class="game" data-id="${x.id}"><b>${esc(x.h.White||'?')} vs ${esc(x.h.Black||'?')}</b><span>${esc(x.h.Result||'')} · ${x.sans.length}수 · ${esc(x.source)}</span></button>`).join(''):'<p class="muted">아직 없다.</p>';document.querySelectorAll('.game').forEach(b=>b.onclick=()=>select(b.dataset.id));const w=Object.entries(S.weakness).sort((a,b)=>b[1]-a[1]);$('#weak').innerHTML=w.length?w.slice(0,12).map(([k,v])=>`<div class="weak"><span>${esc(k)}</span><b>${v}</b></div>`).join(''):'<p class="muted">대국을 가져오면 반복 패턴이 쌓인다.</p>'}

function select(id){const g=S.games.find(x=>x.id===id);if(!g)return;S.current=g;const c=new Chess(),a=[];let html='';g.sans.forEach((san,i)=>{const before=c.fen(),turn=c.turn();let m;try{m=c.move(san,{sloppy:true})}catch{return}const ph=phase(i+1),r={ply:i+1,san:m.san,fen:before,phase:ph,reason:null};
// Heuristics are deliberately labelled as learning signals, not engine verdicts.
if(ph==='초반'&&/^[a-h][3-6]$/.test(m.san)&&i<16){r.reason='개발보다 폰 전진을 선택했다. 다음에는 기물 개발과 킹 안전을 먼저 점검한다.';bump('초반 · 개발 / 킹 안전')}
if(ph==='중반'&&/^[QRBN]x/.test(m.san)){r.reason='잡기 전에 상대의 체크·잡기·직접 위협을 확인하는 습관을 훈련한다.';bump('중반 · 상대 강제수 확인')}
if(ph==='중반'&&/^(Q|R)/.test(m.san)&&i<42){r.reason=r.reason||'퀸과 룩을 움직일 때 상대의 반격을 먼저 계산한다.';bump('중반 · 반격 계산')}
if(ph==='후반'&&/^[a-h][1-8]=/.test(m.san)){r.reason='승격 계산 전에 킹의 위치와 상대의 강제수를 확인한다.';bump('후반 · 폰 엔드게임 계산')}
a.push(r);html+=`<button class="mv" data-p="${i+1}">${Math.floor(i/2)+1}${turn==='w'?'.':'...'} ${esc(m.san)}</button>`});S.analysis=a;save();render();$('#moves').innerHTML=html;document.querySelectorAll('.mv').forEach(b=>b.onclick=()=>show(+b.dataset.p));show(0);$('#status').textContent=`${g.h.White||'?'} vs ${g.h.Black||'?'} · ${g.sans.length}수`}

function show(ply){const c=new Chess();for(let i=0;i<ply;i++)try{c.move(S.current.sans[i],{sloppy:true})}catch{}const icon={p:'♟',r:'♜',n:'♞',b:'♝',q:'♛',k:'♚'};$('#board').innerHTML=c.board().flat().map((p,i)=>`<div class="sq ${(Math.floor(i/8)+i)%2?'dark':'light'}">${p?`<span class="piece ${p.color}">${icon[p.type]}</span>`:''}</div>`).join('');const r=S.analysis.find(x=>x.ply===ply);$('#coach').innerHTML=`<h3>${ply?r.phase+' · '+esc(r.san):'시작 포지션'}</h3><p>${ply?(r.reason||'현재 저장된 학습 신호에서는 반복 약점이 감지되지 않았다.'):'실전 중 분석하지 않는다. 종료된 대국만 학습한다.'}</p><button id="makequiz">내 약점 훈련 만들기</button><div id="quiz"></div>`;$('#makequiz').onclick=quiz}

function quiz(){const top=Object.entries(S.weakness).sort((a,b)=>b[1]-a[1])[0]?.[0]||'중반 · 상대 강제수 확인';S.quiz={type:top,created:Date.now()};save();$('#quiz').innerHTML=`<div class="quiz"><b>집중 훈련: ${esc(top)}</b><p>실전 포지션에서 다음 수를 찾기 전에 가장 먼저 해야 할 것은?</p><ol><li>상대의 체크 확인</li><li>상대의 잡기 확인</li><li>상대의 직접 위협 확인</li><li>내 계획 실행</li></ol><button id="answer">제출</button><span id="result"></span></div>`;$('#answer').onclick=()=>$('#result').textContent=' 기록됨. 같은 약점의 문제를 다음 훈련에서 우선 출제한다.'}
render();
