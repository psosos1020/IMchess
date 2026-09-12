import { Chess } from 'chess.js';
import './style.css';
import { configureEngine, normalizeScore, inferPhase, classify } from './engine.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>\"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const KEY = 'imchess:v3';
let S;
try { S = JSON.parse(localStorage.getItem(KEY) || '{"games":[],"weakness":{},"analysis":{},"quiz":null}'); } catch { S = { games: [], weakness: {}, analysis: {}, quiz: null }; }
S.games ||= []; S.weakness ||= {}; S.analysis ||= {};
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
const bump = k => { S.weakness[k] = (S.weakness[k] || 0) + 1; };
const phaseLabel = p => ({opening:'초반',middlegame:'중반',endgame:'후반'}[p] || p);
const engine = configureEngine();

$('#app').innerHTML = `<header><div><div class="logo">IM<span>chess</span></div><div class="tag">개인 대국 학습 코치</div></div><div class="safe">● 실전 중 분석 차단</div></header><main><section class="hero"><div><h1>네가 반복해서 하는 실수를 찾아낸다.</h1><p>종료된 Chess.com / Lichess 대국을 가져와 실제 엔진으로 복기한다.</p></div><div class="import"><input id="user" placeholder="사용자명"><select id="source"><option value="chesscom">Chess.com</option><option value="lichess">Lichess</option></select><button id="remote">최근 대국 가져오기</button><label class="file">PGN 열기<input id="pgn" type="file" accept=".pgn,.txt"></label></div></section><section class="grid"><article class="panel"><h2>개인 약점</h2><div id="weak"><p class="muted">대국을 가져오면 반복 패턴이 쌓인다.</p></div></article><article class="panel"><h2>최근 대국</h2><div id="games"><p class="muted">아직 없다.</p></div></article></section><section class="panel"><div class="head"><h2>복기</h2><span id="status">대국을 선택하라.</span></div><div class="review"><div><div id="board" class="board"></div><div id="moves" class="moves"></div></div><div id="coach" class="coach"><h3>학습 루프</h3><p>대국 → Stockfish 분석 → 실수 원인 → 반복 패턴 → 퀴즈</p></div></div></section></main>`;

function parsePGN(text, source) {
  const chunks = text.split(/(?=\[Event )/).map(x => x.trim()).filter(Boolean);
  return chunks.map(pgn => {
    try {
      const c = new Chess(), h = {}, sans = [];
      for (const l of pgn.split(/\r?\n/)) { const m = l.match(/^\[([^ ]+)\s+"(.*)"\]$/); if (m) h[m[1]] = m[2]; }
      const body = pgn.replace(/\[[^\n]+\]/g,' ').replace(/\{[^}]*\}/g,' ').replace(/\([^)]*\)/g,' ');
      for (const t of body.replace(/1-0|0-1|1\/2-1\/2|\*/g,' ').trim().split(/\s+/)) {
        if (!t || /^\d+\.{1,3}$/.test(t) || /^\d+\./.test(t)) continue;
        try { const m = c.move(t); if (m) sans.push(m.san); } catch {}
      }
      return sans.length ? { id: crypto.randomUUID(), source, h, sans, pgn } : null;
    } catch { return null; }
  }).filter(Boolean);
}

async function importGames() {
  const u = $('#user').value.trim(); if (!u) return alert('사용자명을 입력하라.');
  const src = $('#source').value; $('#status').textContent = '가져오는 중...';
  try {
    let url, headers = {};
    if (src === 'chesscom') { const d = new Date(); url = `https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/${d.getUTCFullYear()}/${String(d.getUTCMonth()+1).padStart(2,'0')}/pgn`; headers['User-Agent'] = 'IMchess/0.3'; }
    else { url = `https://lichess.org/api/games/user/${encodeURIComponent(u)}?max=30&clocks=true&evals=true&opening=true`; headers.Accept = 'application/x-chess-pgn'; }
    const r = await fetch(url, { headers }); if (!r.ok) throw Error(`HTTP ${r.status}`);
    const gs = parsePGN(await r.text(), src); if (!gs.length) throw Error('읽을 수 있는 대국이 없다.');
    S.games = [...gs, ...S.games].slice(0,300); save(); render(); select(gs[0].id); $('#status').textContent = `${gs.length}판 가져왔다.`;
  } catch (e) { $('#status').textContent = '가져오기 실패'; alert('가져오기 실패: ' + e.message); }
}
$('#remote').onclick = importGames;
$('#pgn').onchange = async e => { const f=e.target.files[0]; if(!f)return; try { const gs=parsePGN(await f.text(),'PGN'); if(!gs.length)throw Error('PGN에서 수를 찾지 못했다.'); S.games=[...gs,...S.games].slice(0,300);save();render();select(gs[0].id); } catch(err){ alert('PGN 오류: '+err.message); } };

function render() {
  const g = $('#games');
  g.innerHTML = S.games.length ? S.games.slice(0,40).map(x => { const an=S.analysis[x.id]; const bl=an?.filter(a=>['blunder','mistake'].includes(a.classification)).length||0; return `<button class="game" data-id="${x.id}"><b>${esc(x.h.White||'?')} vs ${esc(x.h.Black||'?')}</b><span>${esc(x.h.Result||'')} · ${x.sans.length}수 · ${esc(x.source)}${an?` · 실수 ${bl}`:''}</span></button>`; }).join('') : '<p class="muted">아직 없다.</p>';
  document.querySelectorAll('.game').forEach(b=>b.onclick=()=>select(b.dataset.id));
  const w=Object.entries(S.weakness).sort((a,b)=>b[1]-a[1]); $('#weak').innerHTML=w.length?w.slice(0,12).map(([k,v])=>`<div class="weak"><span>${esc(k)}</span><b>${v}</b></div>`).join(''):'<p class="muted">대국을 가져오면 반복 패턴이 쌓인다.</p>';
}

function select(id) {
  const g=S.games.find(x=>x.id===id); if(!g)return; S.current=g;
  const c=new Chess(), a=[]; let html='';
  g.sans.forEach((san,i)=>{ const before=c.fen(), turn=c.turn(); try { const m=c.move(san); a.push({ply:i+1,san:m.san,fen:before,phase:phaseLabel(inferPhase(c))}); html+=`<button class="mv" data-p="${i+1}">${Math.floor(i/2)+1}${turn==='w'?'.':'...'} ${esc(m.san)}</button>`; } catch {} });
  S.basic=a; $('#moves').innerHTML=html; document.querySelectorAll('.mv').forEach(b=>b.onclick=()=>show(+b.dataset.p)); show(0); save(); render(); $('#status').textContent=`${g.h.White||'?'} vs ${g.h.Black||'?'} · ${g.sans.length}수`;
}

async function runAnalysis() {
  const g=S.current; if(!g)return; const depth=Number($('#depth')?.value||15); const c=new Chess(),results=[];
  $('#analyze').disabled=true;
  try {
    for(let i=0;i<g.sans.length;i++){
      const fen=c.fen(), turn=c.turn(); $('#status').textContent=`Stockfish 분석 ${i+1}/${g.sans.length} · depth ${depth}`;
      const best=await engine.analyze(fen,depth); const before=normalizeScore(best.info,turn); const played=c.move(g.sans[i]); if(!played)continue;
      const afterInfo=await engine.analyze(c.fen(),depth); const after=afterInfo?normalizeScore(afterInfo.info,c.turn()):null; const playedScore=after==null?null:-after;
      const cpLoss=before==null||playedScore==null?null:Math.max(0,Math.round(before-playedScore)); const p=inferPhase(c); const classification=classify(cpLoss); const category=classification==='good'||classification==='normal'||classification==='unrated'?'none':(p==='opening'?'개발 / 킹 안전':p==='endgame'?'킹 활동 / 변환':'계산 / 상대 강제수');
      if(category!=='none')bump(`${phaseLabel(p)} · ${category}`);
      results.push({ply:i+1,fen,san:played.san,bestmove:best.bestmove,evalBefore:before,evalAfter:playedScore,cpLoss,classification,phase:p,category}); S.analysis[g.id]=results; save(); show(i+1);
    }
    $('#status').textContent=`분석 완료 · depth ${depth}`; render(); show(0);
  } catch(e) { $('#status').textContent='Stockfish 오류'; alert('복기 실패: '+e.message); }
  finally { $('#analyze').disabled=false; }
}

function show(ply) {
  if(!S.current)return; const c=new Chess(); for(let i=0;i<ply;i++)try{c.move(S.current.sans[i]);}catch{}
  const icon={p:'♟',r:'♜',n:'♞',b:'♝',q:'♛',k:'♚'}; $('#board').innerHTML=c.board().flat().map((p,i)=>`<div class="sq ${(Math.floor(i/8)+i)%2?'dark':'light'}">${p?`<span class="piece ${p.color}">${icon[p.type]}</span>`:''}</div>`).join('');
  const an=S.analysis[S.current.id]||[], r=an.find(x=>x.ply===ply); $('#coach').innerHTML=`<h3>${ply?(r?phaseLabel(r.phase)+' · '+esc(r.san):phaseLabel(S.basic?.[ply-1]?.phase||'중반')):'시작 포지션'}</h3><div class="enginebar"><button id="analyze">Stockfish 복기</button><label>Depth <select id="depth"><option>10</option><option>12</option><option selected>15</option><option>18</option></select></label></div><p>${r?`판정: <b>${r.classification}</b> · CPL ${r.cpLoss??'?'}`:'수순을 선택하거나 Stockfish 복기를 눌러라.'}</p>${r&&['blunder','mistake','inaccuracy'].includes(r.classification)?`<div class="signal">약점: ${esc(r.category)}<br>Stockfish 최선수: <b>${esc(r.bestmove||'?')}</b></div>`:''}<button id="makequiz">이 실수로 훈련 만들기</button><div id="quiz"></div>`;
  $('#analyze').onclick=runAnalysis; $('#makequiz').onclick=()=>quiz(r);
}
function quiz(r){const key=r?`${phaseLabel(r.phase)} · ${r.category}`:(Object.entries(S.weakness).sort((a,b)=>b[1]-a[1])[0]?.[0]||'중반 · 계산 / 상대 강제수');S.quiz={type:key,sourceGame:S.current?.id,ply:r?.ply,created:Date.now()};save();$('#quiz').innerHTML=`<div class="quiz"><b>집중 훈련: ${esc(key)}</b><p>이 포지션에서 먼저 확인할 것은?</p><ol><li>상대의 체크</li><li>상대의 잡기</li><li>상대의 직접 위협</li><li>내 후보수</li></ol><button id="answer">제출</button><span id="result"></span></div>`;$('#answer').onclick=()=>$('#result').textContent=' 기록됨.';}
render();
