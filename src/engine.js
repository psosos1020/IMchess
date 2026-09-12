const STOCKFISH_URL='https://cdn.jsdelivr.net/npm/stockfish@18.0.8/src/stockfish-18-lite-single.js';

export class StockfishEngine {
  constructor(){this.worker=null;this.ready=null;this.seq=0;this.pending=new Map()}
  async start(){if(this.ready)return this.ready;this.ready=new Promise((resolve,reject)=>{try{const code=`importScripts('${STOCKFISH_URL}');`;const blob=new Blob([code],{type:'text/javascript'});this.worker=new Worker(URL.createObjectURL(blob));let ok=false;this.worker.onmessage=e=>{const s=String(e.data||'');if(s.includes('uciok')){ok=true;resolve()}const m=s.match(/^info .*?score (cp|mate) (-?\d+)/);if(m)this.lastInfo={kind:m[1],value:+m[2],raw:s};if(s.startsWith('bestmove ')){const bm=s.split(/\s+/)[1];const p=this.pending.get(this.seq);if(p){this.pending.delete(this.seq);p({bestmove:bm,info:this.lastInfo||null})}}};this.worker.onerror=e=>{if(!ok)reject(Error('Stockfish worker 로딩 실패'))};this.worker.postMessage('uci');this.worker.postMessage('setoption name Threads value 1');this.worker.postMessage('setoption name Hash value 64');setTimeout(()=>{if(!ok)reject(Error('Stockfish 초기화 시간 초과'))},20000)}catch(e){reject(e)}});return this.ready}
  async analyze(fen,depth=16){await this.start();const id=++this.seq;return new Promise((resolve,reject)=>{this.pending.set(id,resolve);this.lastInfo=null;this.worker.postMessage('position fen '+fen);this.worker.postMessage('go depth '+depth);setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);this.worker.postMessage('stop');reject(Error('분석 시간 초과'))}},45000)})}
  stop(){this.worker?.postMessage('stop')}
  destroy(){this.worker?.terminate();this.worker=null;this.ready=null}
}

export function moveToUci(m){return m.from+m.to+(m.promotion||'')}
export function normalizeScore(info,turn){if(!info)return null;if(info.kind==='mate')return info.value>0?100000:-100000;return info.value*(turn==='w'?1:-1)}
export async function analyzeGame(game,{depth=16,onProgress}={}){const chess=new ChessCtor();const out=[];for(let i=0;i<game.sans.length;i++){const before=chess.fen();const turn=chess.turn();const best=await engine.analyze(before,depth);const beforeScore=normalizeScore(best.info,turn);const played=chess.move(game.sans[i]);if(!played)continue;const after=await engine.analyze(chess.fen(),depth);const afterScore=normalizeScore(after.info,chess.turn());const playedScore=afterScore==null?null:-afterScore;const loss=beforeScore==null||playedScore==null?null:Math.max(0,Math.round(beforeScore-playedScore));out.push({ply:i+1,fen:before,san:played.san,uci:moveToUci(played),bestmove:best.bestmove,bestScore:beforeScore,playedScore,cpLoss:loss,phase:inferPhase(chess),classification:classify(loss),category:classifyReason(chess,played,loss)});onProgress?.(i+1,game.sans.length)}return out}

export function inferPhase(c){const pieces=c.board().flat().filter(Boolean);const queens=pieces.filter(p=>p.type==='q').length;const minors=pieces.filter(p=>['b','n'].includes(p.type)).length;const nonPawns=pieces.filter(p=>['q','r','b','n'].includes(p.type)).length;const ply=c.history().length;if(ply<=18)return 'opening';if(queens===0&&nonPawns<=5)return 'endgame';if(queens===0&&minors<=2)return 'endgame';return 'middlegame'}
export function classify(loss){if(loss==null)return 'unrated';if(loss>=250)return 'blunder';if(loss>=100)return 'mistake';if(loss>=50)return 'inaccuracy';if(loss<=20)return 'good';return 'normal'}
export function classifyReason(c,m,loss){if(loss<50)return 'none';const forcing=c.moves({verbose:true}).filter(x=>x.captured||x.san?.startsWith('+')||x.san?.startsWith('#')).length;if(forcing>0)return 'calculation / forcing moves';if(['q','r'].includes(m.piece?.type))return 'piece activity / plan';return 'calculation'}
let engine,ChessCtor;
export function configureEngine(chessCtor){ChessCtor=chessCtor;engine=new StockfishEngine();return engine}
export function getEngine(){return engine}
