const STOCKFISH_URL = 'https://cdn.jsdelivr.net/npm/stockfish@18.0.8/src/stockfish-18-lite-single.js';

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.seq = 0;
    this.pending = new Map();
    this.lastInfo = null;
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      try {
        // Do not wrap Stockfish in a Blob worker. Stockfish loads its WASM beside
        // the JS file, so a Blob URL breaks that relative asset lookup.
        this.worker = new Worker(STOCKFISH_URL);
        this.worker.onmessage = (e) => {
          const s = String(e.data ?? '');
          if (s.startsWith('info ')) {
            const mate = s.match(/\bscore mate (-?\d+)/);
            const cp = s.match(/\bscore cp (-?\d+)/);
            if (mate) this.lastInfo = { kind: 'mate', value: Number(mate[1]), raw: s };
            else if (cp) this.lastInfo = { kind: 'cp', value: Number(cp[1]), raw: s };
          }
          if (s === 'uciok' && !settled) {
            this.worker.postMessage('setoption name Threads value 1');
            this.worker.postMessage('setoption name Hash value 64');
            this.worker.postMessage('isready');
          }
          if (s === 'readyok' && !settled) {
            settled = true;
            resolve();
          }
          if (s.startsWith('bestmove ')) {
            const bestmove = s.split(/\s+/)[1] || null;
            const request = this.pending.get(this.activeId);
            if (request) {
              this.pending.delete(this.activeId);
              request.resolve({ bestmove, info: this.lastInfo });
            }
          }
        };
        this.worker.onerror = (e) => {
          if (!settled) {
            settled = true;
            reject(new Error(`Stockfish 로딩 실패: ${e?.message || 'worker error'}`));
          }
        };
        this.worker.postMessage('uci');
        setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Stockfish 초기화 시간 초과'));
          }
        }, 20000);
      } catch (e) {
        reject(e);
      }
    }).catch((err) => {
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
      throw err;
    });
    return this.ready;
  }

  async analyze(fen, depth = 16) {
    await this.start();
    const id = ++this.seq;
    this.activeId = id;
    this.lastInfo = null;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
      setTimeout(() => {
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        this.worker.postMessage('stop');
        reject(new Error('분석 시간 초과'));
      }, 60000);
    });
  }

  stop() {
    this.worker?.postMessage('stop');
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.pending.clear();
  }
}

export function moveToUci(m) {
  return m.from + m.to + (m.promotion || '');
}

export function normalizeScore(info, turn) {
  if (!info) return null;
  const sign = turn === 'w' ? 1 : -1;
  if (info.kind === 'mate') return sign * (info.value > 0 ? 100000 : -100000);
  return sign * info.value;
}

export function inferPhase(c) {
  const pieces = c.board().flat().filter(Boolean);
  const queens = pieces.filter(p => p.type === 'q').length;
  const minors = pieces.filter(p => ['b', 'n'].includes(p.type)).length;
  const nonPawns = pieces.filter(p => ['q', 'r', 'b', 'n'].includes(p.type)).length;
  const ply = c.history().length;
  if (ply <= 18) return 'opening';
  if (queens === 0 && nonPawns <= 5) return 'endgame';
  if (queens === 0 && minors <= 2) return 'endgame';
  return 'middlegame';
}

export function classify(loss) {
  if (loss == null) return 'unrated';
  if (loss >= 250) return 'blunder';
  if (loss >= 100) return 'mistake';
  if (loss >= 50) return 'inaccuracy';
  if (loss <= 20) return 'good';
  return 'normal';
}

export function classifyReason(c, m, loss) {
  if (loss == null || loss < 50) return 'none';
  const forcing = c.moves({ verbose: true }).filter(x => x.captured || x.san?.startsWith('+') || x.san?.startsWith('#')).length;
  if (forcing > 0) return '계산 / 강제수 대응';
  if (['q', 'r'].includes(m.piece?.type)) return '기물 활동 / 계획';
  return '계산 / 후보수 검증';
}

let engine;
export function configureEngine() {
  engine = new StockfishEngine();
  return engine;
}
export function getEngine() {
  return engine;
}
