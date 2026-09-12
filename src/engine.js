const ENGINE_URL = new URL(`${import.meta.env.BASE_URL}engine/stockfish-18-lite-single.js`, document.baseURI);

export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.seq = 0;
    this.pending = null;
    this.lastInfo = null;
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      try {
        this.worker = new Worker(ENGINE_URL);
        const fail = (message) => {
          if (settled) return;
          settled = true;
          reject(new Error(message));
        };
        this.worker.onmessage = (event) => {
          const line = String(event.data ?? '').trim();
          if (line.startsWith('info ')) {
            const mate = line.match(/\bscore mate (-?\d+)/);
            const cp = line.match(/\bscore cp (-?\d+)/);
            if (mate) this.lastInfo = { kind: 'mate', value: Number(mate[1]), raw: line };
            else if (cp) this.lastInfo = { kind: 'cp', value: Number(cp[1]), raw: line };
          }
          if (line === 'uciok') {
            this.worker.postMessage('setoption name Hash value 64');
            this.worker.postMessage('isready');
          }
          if (line === 'readyok' && !settled) {
            settled = true;
            resolve();
          }
          if (line.startsWith('bestmove ')) {
            const request = this.pending;
            if (!request) return;
            this.pending = null;
            clearTimeout(request.timer);
            request.resolve({ bestmove: line.split(/\s+/)[1] || null, info: this.lastInfo });
          }
        };
        this.worker.onerror = (event) => fail(`Stockfish 로딩 실패: ${event?.message || 'Worker/WASM 오류'}`);
        this.worker.onmessageerror = () => fail('Stockfish Worker 메시지 처리 실패');
        this.worker.postMessage('uci');
        setTimeout(() => { if (!settled) fail('Stockfish 초기화 시간 초과'); }, 20000);
      } catch (error) {
        fail(`Stockfish 시작 실패: ${error?.message || error}`);
      }
    }).catch((error) => {
      this.ready = null;
      this.worker?.terminate();
      this.worker = null;
      throw error;
    });
    return this.ready;
  }

  async analyze(fen, depth = 16) {
    await this.start();
    this.stop();
    const id = ++this.seq;
    this.lastInfo = null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending || this.pending.id !== id) return;
        this.pending = null;
        this.worker?.postMessage('stop');
        reject(new Error('Stockfish 분석 시간 초과'));
      }, 60000);
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  stop() {
    this.worker?.postMessage('stop');
  }

  destroy() {
    this.stop();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Stockfish가 종료되었습니다'));
    }
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

export function configureEngine() { return new StockfishEngine(); }
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
