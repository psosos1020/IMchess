const WORKER_URL = new URL('./stockfish-worker.js', import.meta.url);

export class StockfishEngine {
  constructor() { this.worker=null; this.ready=null; this.seq=0; this.pending=new Map(); this.activeId=null; this.lastInfo=null; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve,reject)=>{
      let settled=false;
      try {
        this.worker=new Worker(WORKER_URL,{type:'classic'});
        this.worker.onmessage=e=>{
          const s=String(e.data??'');
          if(s.startsWith('info ')){const mate=s.match(/\bscore mate (-?\d+)/),cp=s.match(/\bscore cp (-?\d+)/);if(mate)this.lastInfo={kind:'mate',value:Number(mate[1]),raw:s};else if(cp)this.lastInfo={kind:'cp',value:Number(cp[1]),raw:s};}
          if(s==='uciok'){this.worker.postMessage('setoption name Threads value 1');this.worker.postMessage('setoption name Hash value 64');this.worker.postMessage('isready');}
          if(s==='readyok'&&!settled){settled=true;resolve();}
          if(s.startsWith('bestmove ')){const request=this.pending.get(this.activeId);if(request){this.pending.delete(this.activeId);clearTimeout(request.timer);request.resolve({bestmove:s.split(/\s+/)[1]||null,info:this.lastInfo});}}
        };
        this.worker.onerror=e=>{if(!settled){settled=true;reject(new Error(`Stockfish 로딩 실패: ${e?.message||'worker error'}`));}};
        this.worker.postMessage('uci');
        setTimeout(()=>{if(!settled){settled=true;reject(new Error('Stockfish 초기화 시간 초과'));}},20000);
      }catch(e){reject(e);}
    }).catch(err=>{this.ready=null;this.worker?.terminate();this.worker=null;throw err;});
    return this.ready;
  }
  async analyze(fen,depth=16){await this.start();if(this.activeId!==null)this.stop();const id=++this.seq;this.activeId=id;this.lastInfo=null;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(!this.pending.has(id))return;this.pending.delete(id);this.worker.postMessage('stop');reject(new Error('분석 시간 초과'));},60000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage(`position fen ${fen}`);this.worker.postMessage(`go depth ${depth}`);});}
  stop(){this.worker?.postMessage('stop');}
  destroy(){this.worker?.terminate();this.worker=null;this.ready=null;this.pending.clear();this.activeId=null;}
}
export function configureEngine(){return new StockfishEngine();}
export function normalizeScore(info,turn){if(!info)return null;const sign=turn==='w'?1:-1;if(info.kind==='mate')return sign*(info.value>0?100000:-100000);return sign*info.value;}
export function inferPhase(c){const pieces=c.board().flat().filter(Boolean),queens=pieces.filter(p=>p.type==='q').length,minors=pieces.filter(p=>['b','n'].includes(p.type)).length,nonPawns=pieces.filter(p=>['q','r','b','n'].includes(p.type)).length,ply=c.history().length;if(ply<=18)return'opening';if(queens===0&&nonPawns<=5)return'endgame';if(queens===0&&minors<=2)return'endgame';return'middlegame';}
export function classify(loss){if(loss==null)return'unrated';if(loss>=250)return'blunder';if(loss>=100)return'mistake';if(loss>=50)return'inaccuracy';if(loss<=20)return'good';return'normal';}
