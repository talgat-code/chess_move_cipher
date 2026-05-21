/* ============================================================
   Chess Move Cipher — Frontend
   ============================================================ */

'use strict';

// ─── Piece rendering ───────────────────────────────────────

const PIECE_UNICODE = {
  K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

const FILES = 'abcdefgh';

function parseFEN(fen) {
  const ranks = fen.split(' ')[0].split('/');
  const pieces = {};
  ranks.forEach((rank, ri) => {
    let fi = 0;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        fi += parseInt(ch, 10);
      } else {
        const sq = FILES[fi] + (8 - ri);
        pieces[sq] = ch;
        fi++;
      }
    }
  });
  return pieces;
}

// ─── Chess Board class ─────────────────────────────────────

class ChessBoard {
  constructor(containerId) {
    this.el = document.getElementById(containerId);
    this.squares = {};
    this._build();
    this.setFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  _build() {
    this.el.innerHTML = '';
    for (let rank = 8; rank >= 1; rank--) {
      for (let fi = 0; fi < 8; fi++) {
        const sq = FILES[fi] + rank;
        const div = document.createElement('div');
        const isLight = (fi + rank) % 2 === 0;
        div.className = 'sq ' + (isLight ? 'light' : 'dark');
        div.dataset.sq = sq;
        this.squares[sq] = div;
        this.el.appendChild(div);
      }
    }
  }

  setFEN(fen) {
    const pieces = parseFEN(fen);
    for (const [sq, div] of Object.entries(this.squares)) {
      const pc = pieces[sq];
      if (pc) {
        const isWhite = pc === pc.toUpperCase();
        div.textContent = PIECE_UNICODE[pc];
        div.className = div.className.replace(/\s*piece-\S*/g, '') +
          (isWhite ? ' piece-white' : ' piece-black');
      } else {
        div.textContent = '';
        div.className = div.className.replace(/\s*piece-\S*/g, '');
      }
    }
  }

  clearHighlights() {
    for (const div of Object.values(this.squares)) {
      div.classList.remove('hl-from', 'hl-to', 'hl-last');
    }
  }

  highlight(from, to) {
    this.clearHighlights();
    if (this.squares[from]) this.squares[from].classList.add('hl-from');
    if (this.squares[to])   this.squares[to].classList.add('hl-to');
  }

  showLast(from, to) {
    this.clearHighlights();
    if (this.squares[from]) this.squares[from].classList.add('hl-last');
    if (this.squares[to])   this.squares[to].classList.add('hl-last');
  }

  reset() {
    this.clearHighlights();
    this.setFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }
}

// ─── Hero decorative board ─────────────────────────────────

function buildHeroBoard() {
  const el = document.getElementById('hero-board');
  if (!el) return;
  const startFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const pieces = parseFEN(startFEN + ' w KQkq - 0 1');
  for (let rank = 8; rank >= 1; rank--) {
    for (let fi = 0; fi < 8; fi++) {
      const sq = FILES[fi] + rank;
      const div = document.createElement('div');
      const isLight = (fi + rank) % 2 === 0;
      div.className = 'sq ' + (isLight ? 'light' : 'dark');
      const pc = pieces[sq];
      if (pc) {
        div.textContent = PIECE_UNICODE[pc];
        div.classList.add(pc === pc.toUpperCase() ? 'piece-white' : 'piece-black');
      }
      el.appendChild(div);
    }
  }
}

// ─── Tabs ──────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ─── Password toggle ───────────────────────────────────────

function initPasswordToggles() {
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });
}

// ─── Bit stream visualization ──────────────────────────────

function buildBitStream(bits, steps) {
  const container = document.getElementById('bits-stream');
  container.innerHTML = '';

  // Header block (first 32 bits = length)
  const headerBlock = document.createElement('span');
  headerBlock.className = 'bit-block header';
  headerBlock.textContent = bits.slice(0, 32);
  headerBlock.title = '32-bit length header';
  container.appendChild(headerBlock);

  // One block per step
  steps.forEach((step, i) => {
    const block = document.createElement('span');
    block.className = 'bit-block pending';
    block.textContent = step.bits_encoded;
    block.dataset.step = i;
    block.title = `Move ${i + 1}: ${step.move} | index ${step.move_index} | k=${step.k}`;
    container.appendChild(block);
  });

  document.getElementById('bits-total-tag').textContent = bits.length + ' bits';
  document.getElementById('bits-section').style.display = 'block';
}

function activateBitBlock(stepIndex) {
  document.querySelectorAll('.bit-block[data-step]').forEach(b => {
    const si = parseInt(b.dataset.step, 10);
    if (si < stepIndex) {
      b.className = 'bit-block done';
    } else if (si === stepIndex) {
      b.className = 'bit-block active';
      b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      b.className = 'bit-block pending';
    }
  });
}

// ─── Animator class ────────────────────────────────────────

class MoveAnimator {
  constructor(board, steps) {
    this.board = board;
    this.steps = steps;
    this.index = -1;
    this.timer = null;
    this.playing = false;
    this.speed = 700;

    this._bindControls();
  }

  _bindControls() {
    const ctrl = document.getElementById('anim-controls');
    ctrl.style.display = 'flex';
    document.getElementById('step-info').style.display = 'block';

    document.getElementById('btn-play').addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-next').addEventListener('click', () => {
      this.pause();
      this.stepForward();
    });
    document.getElementById('btn-prev').addEventListener('click', () => {
      this.pause();
      this.stepBackward();
    });
    document.getElementById('speed-slider').addEventListener('input', e => {
      this.speed = parseInt(e.target.value, 10);
      if (this.playing) { this.pause(); this.play(); }
    });
  }

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    this.playing = true;
    const playBtn = document.getElementById('btn-play');
    playBtn.textContent = '⏸';
    playBtn.classList.add('paused');
    this.timer = setInterval(() => {
      if (this.index >= this.steps.length - 1) {
        this.pause();
        return;
      }
      this.stepForward();
    }, this.speed);
  }

  pause() {
    this.playing = false;
    clearInterval(this.timer);
    const playBtn = document.getElementById('btn-play');
    playBtn.textContent = '▶';
    playBtn.classList.remove('paused');
  }

  stepForward() {
    if (this.index >= this.steps.length - 1) return;
    this.index++;
    this._renderStep(this.index);
  }

  stepBackward() {
    if (this.index <= 0) {
      this.index = -1;
      this.board.reset();
      this._updateUI(-1);
      return;
    }
    this.index--;
    // Replay from start to current index
    this.board.reset();
    for (let i = 0; i <= this.index; i++) {
      this.board.setFEN(this.steps[i].fen);
    }
    this._renderStep(this.index);
  }

  _renderStep(i) {
    const step = this.steps[i];
    const from = step.move.slice(0, 2);
    const to   = step.move.slice(2, 4);

    // Show position before the move
    this.board.setFEN(step.fen);
    this.board.highlight(from, to);

    // After a short delay, advance the position
    setTimeout(() => {
      if (i < this.steps.length - 1) {
        this.board.setFEN(this.steps[i + 1].fen);
      }
      this.board.showLast(from, to);
    }, Math.min(this.speed * 0.45, 400));

    activateBitBlock(i);
    this._updateUI(i);
  }

  _updateUI(i) {
    const progress = document.getElementById('anim-progress');
    progress.textContent = (i + 1) + ' / ' + this.steps.length;

    if (i < 0) {
      document.getElementById('si-move').textContent = '—';
      document.getElementById('si-bits').textContent = '—';
      document.getElementById('si-index').textContent = '—';
      document.getElementById('si-k').textContent = '—';
      return;
    }

    const step = this.steps[i];
    document.getElementById('si-move').textContent = step.move;
    document.getElementById('si-bits').textContent = step.bits_encoded;
    document.getElementById('si-index').textContent =
      step.move_index + ' / ' + (step.usable_count - 1);
    document.getElementById('si-k').textContent =
      step.k + ' bit' + (step.k !== 1 ? 's' : '') + ' / move';
  }
}

// ─── Board resize (ensures equal square pixels) ────────────

function resizeBoards() {
  document.querySelectorAll('.chess-board').forEach(board => {
    const wrap = board.closest('.board-wrap') || board.parentElement;
    const maxSq = 52;
    const minSq = 28;
    const available = wrap.clientWidth || 416;
    const sq = Math.max(minSq, Math.min(maxSq, Math.floor(available / 8)));
    board.style.gridTemplateColumns = `repeat(8, ${sq}px)`;
    board.style.gridTemplateRows    = `repeat(8, ${sq}px)`;
    board.style.width  = (sq * 8) + 'px';
    board.style.height = (sq * 8) + 'px';
    board.style.fontSize = Math.max(14, Math.floor(sq * 0.55)) + 'px';
  });
}

// ─── How-It-Works Demo animations ─────────────────────────

function demoSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
}

/* ── Demo 1: Text → Bits ── */
async function runDemo1(signal) {
  const charEl    = document.getElementById('d1-char');
  const bitsEl    = document.getElementById('d1-bits');
  const streamEl  = document.getElementById('d1-stream');
  if (!charEl) return;

  const word = 'Hello!';
  const headerLen = word.length;

  const resetStream = () => {
    streamEl.innerHTML = `<span class="d1-block hdr" title="${headerLen} bytes = ${headerLen.toString(2).padStart(32,'0')}">[len=${headerLen}]</span>`;
  };
  resetStream();

  while (!signal.aborted) {
    for (const ch of word) {
      if (signal.aborted) return;
      const code   = ch.charCodeAt(0);
      const binary = code.toString(2).padStart(8, '0');

      // flash the char
      charEl.textContent = ch;
      charEl.classList.add('flash');
      setTimeout(() => charEl.classList.remove('flash'), 260);

      // reset bits display
      bitsEl.innerHTML = '';
      for (let i = 0; i < 8; i++) {
        const s = document.createElement('span');
        s.className = 'bc';
        s.textContent = binary[i];
        bitsEl.appendChild(s);
      }

      await demoSleep(280, signal);

      // light up bits one by one
      const cells = bitsEl.querySelectorAll('.bc');
      for (let i = 0; i < 8; i++) {
        if (signal.aborted) return;
        cells[i].classList.add('lit');
        await demoSleep(65, signal);
      }

      await demoSleep(350, signal);

      // add to stream
      const blk = document.createElement('span');
      blk.className = 'd1-block chr';
      blk.title = `'${ch}' = ${code}`;
      blk.textContent = binary;
      streamEl.appendChild(blk);

      await demoSleep(550, signal);
    }
    await demoSleep(1400, signal);
    resetStream();
    await demoSleep(400, signal);
  }
}

/* ── Demo 2: HMAC Key Ordering ── */
const DEMO2_MOVES_UNSORTED = [
  { move: 'e2e4', hmac: '8b3d7c2a' },
  { move: 'd2d4', hmac: '3a9f1b4e' },
  { move: 'g1f3', hmac: '1d4a2c8b' },
  { move: 'c2c4', hmac: 'a3e4f2d1' },
  { move: 'b1c3', hmac: 'f1e9c458' },
];
const DEMO2_MOVES_SORTED = [...DEMO2_MOVES_UNSORTED].sort((a, b) => a.hmac.localeCompare(b.hmac));
// sorted: g1f3(1d), d2d4(3a), e2e4(8b), c2c4(a3), b1c3(f1)

function renderD2List(listEl, moves, mode) {
  listEl.innerHTML = moves.map((m, i) => {
    const usable = i < 4; // 2^2=4 for k=2 demo
    let badge = '';
    if (mode === 'sorted') badge = usable
      ? `<span class="d2-badge use">✓ #${i}</span>`
      : `<span class="d2-badge skip">skip</span>`;
    const rowClass = mode === 'sorted' ? (usable ? 'd2-row usable' : 'd2-row') : 'd2-row';
    const hmacShow = (mode === 'scores' || mode === 'sorted') ? m.hmac + '…' : '?';
    return `<div class="${rowClass}">
      <span class="d2-idx">${i + 1}</span>
      <span class="d2-move">${m.move}</span>
      <span class="d2-hmac">${hmacShow}</span>
      ${badge}
    </div>`;
  }).join('');
}

async function runDemo2(signal) {
  const statusEl = document.getElementById('d2-status');
  const listEl   = document.getElementById('d2-list');
  const calcEl   = document.getElementById('d2-calc');
  if (!statusEl) return;

  while (!signal.aborted) {
    // Phase 1: show unsorted, no scores
    statusEl.textContent = '5 legal moves found';
    calcEl.innerHTML = '';
    renderD2List(listEl, DEMO2_MOVES_UNSORTED, 'none');
    await demoSleep(1100, signal);

    // Phase 2: show HMAC scores appearing
    statusEl.textContent = 'Computing HMAC-SHA256 for each move…';
    renderD2List(listEl, DEMO2_MOVES_UNSORTED, 'scores');
    await demoSleep(1200, signal);

    // Phase 3: sort
    statusEl.textContent = 'Sorting by HMAC score…';
    renderD2List(listEl, DEMO2_MOVES_SORTED, 'sorted');
    await demoSleep(1300, signal);

    // Phase 4: k calculation
    statusEl.textContent = '⌊log₂(5)⌋ = 2 bits/move → use first 4';
    calcEl.innerHTML = 'k = <strong>2</strong> &nbsp;→&nbsp; 2² = <strong>4</strong> usable moves';
    await demoSleep(2200, signal);

    calcEl.innerHTML = '';
  }
}

/* ── Demo 3: Bits → Move selection ── */
const DEMO3_MOVES = ['g1f3', 'd2d4', 'e2e4', 'c2c4'];
const DEMO3_CHUNKS = ['00', '01', '10', '11'];

async function runDemo3(signal) {
  const chunksEl = document.getElementById('d3-chunks');
  const eqEl     = document.getElementById('d3-eq');
  const movesEl  = document.getElementById('d3-moves');
  if (!chunksEl) return;

  let cur = 0;
  while (!signal.aborted) {
    const chunkIdx = cur % DEMO3_CHUNKS.length;
    const chunk    = DEMO3_CHUNKS[chunkIdx];
    const idx      = parseInt(chunk, 2);

    // render chunk pills
    chunksEl.innerHTML = DEMO3_CHUNKS.map((c, i) => {
      let cls = 'd3-chunk';
      if (i < chunkIdx) cls += ' done';
      else if (i === chunkIdx) cls += ' active';
      return `<span class="${cls}">${c}</span>`;
    }).join('');

    await demoSleep(300, signal);

    // equation
    eqEl.innerHTML = `<em>"${chunk}"</em><sub>2</sub> = <strong>${idx}</strong>  →  move[<strong>${idx}</strong>]`;

    // move list
    movesEl.innerHTML = DEMO3_MOVES.map((m, i) => `
      <div class="d3-move ${i === idx ? 'selected' : ''}">
        <span class="d3-move-idx">${i}</span>
        <span class="d3-move-uci">${m}</span>
        <span class="d3-move-arrow">← play</span>
      </div>`).join('');

    await demoSleep(1800, signal);
    cur++;
    if (cur % DEMO3_CHUNKS.length === 0) {
      await demoSleep(600, signal);
    }
  }
}

/* ── IntersectionObserver launcher ── */
function watchDemo(elementId, runFn) {
  const el = document.getElementById(elementId);
  if (!el) return;
  let ctrl = null;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        if (!ctrl || ctrl.signal.aborted) {
          ctrl = new AbortController();
          runFn(ctrl.signal).catch(() => {});
        }
      } else {
        ctrl?.abort();
        ctrl = null;
      }
    });
  }, { threshold: 0.25 });
  obs.observe(el);
}

// ─── Encrypt handler ───────────────────────────────────────

let encBoard = null;
let animator = null;

function initEncBoard() {
  encBoard = new ChessBoard('enc-board');
}

async function handleEncrypt() {
  const message = document.getElementById('enc-message').value.trim();
  const key     = document.getElementById('enc-key').value.trim();
  const errEl   = document.getElementById('enc-error');
  const btn     = document.getElementById('encrypt-btn');

  errEl.style.display = 'none';

  if (!message) { showError(errEl, 'Please enter a message.'); return; }
  if (!key)     { showError(errEl, 'Please enter a key.'); return; }

  // Stop previous animation
  if (animator) animator.pause();

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Encrypting…';
  encBoard.reset();
  encBoard.el.classList.add('encrypting');

  // Hide previous output
  ['bits-section', 'enc-stats', 'pgn-section'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.getElementById('step-info').style.display = 'none';
  document.getElementById('anim-controls').style.display = 'none';

  try {
    const res = await fetch('/api/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, key }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showError(errEl, data.error || 'Encryption failed.');
      return;
    }

    encBoard.el.classList.remove('encrypting');
    encBoard.reset();

    // Build bit stream visualization
    buildBitStream(data.bits, data.steps);

    // Stats
    document.getElementById('stat-games').textContent = data.game_count;
    document.getElementById('stat-moves').textContent = data.move_count;
    document.getElementById('stat-bits').textContent  = data.bit_count;
    document.getElementById('stat-efficiency').textContent =
      (data.bit_count / data.move_count).toFixed(1);
    document.getElementById('enc-stats').style.display = 'flex';

    // PGN
    document.getElementById('pgn-output').value = data.pgn;
    document.getElementById('pgn-section').style.display = 'block';

    // Animator
    animator = new MoveAnimator(encBoard, data.steps);
    animator.play();

    // Store PGN for download
    document.getElementById('download-pgn')._pgn = data.pgn;

  } catch (err) {
    showError(errEl, 'Network error: ' + err.message);
    encBoard.el.classList.remove('encrypting');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">♟</span> Encrypt Message';
  }
}

// ─── Decrypt handler ───────────────────────────────────────

async function handleDecrypt() {
  const pgn = document.getElementById('dec-pgn').value.trim();
  const key = document.getElementById('dec-key').value.trim();
  const errEl = document.getElementById('dec-error');
  const btn = document.getElementById('decrypt-btn');

  errEl.style.display = 'none';
  document.getElementById('dec-result').style.display = 'none';
  document.getElementById('dec-placeholder').style.display = 'block';

  if (!pgn) { showError(errEl, 'Please paste the PGN data.'); return; }
  if (!key) { showError(errEl, 'Please enter the key.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Decrypting…';

  try {
    const res = await fetch('/api/decrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn, key }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      showError(errEl, data.error || 'Decryption failed.');
      return;
    }

    document.getElementById('dec-placeholder').style.display = 'none';
    document.getElementById('dec-message').textContent = data.message;
    document.getElementById('dec-result').style.display = 'block';

  } catch (err) {
    showError(errEl, 'Network error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">♜</span> Decrypt Message';
  }
}

// ─── Copy / Download ───────────────────────────────────────

function initClipboardButtons() {
  document.getElementById('copy-pgn').addEventListener('click', () => {
    const text = document.getElementById('pgn-output').value;
    navigator.clipboard.writeText(text).then(() => flash('copy-pgn', '✓ Copied!'));
  });

  document.getElementById('download-pgn').addEventListener('click', () => {
    const pgn = document.getElementById('download-pgn')._pgn;
    if (!pgn) return;
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'encrypted_message.cpgn';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('copy-message').addEventListener('click', () => {
    const text = document.getElementById('dec-message').textContent;
    navigator.clipboard.writeText(text).then(() => flash('copy-message', '✓ Copied!'));
  });
}

function flash(id, label) {
  const btn = document.getElementById(id);
  const orig = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

// ─── Helpers ───────────────────────────────────────────────

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

// ─── Navbar scroll effect ──────────────────────────────────

function initNavbar() {
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    navbar.style.background = window.scrollY > 20
      ? 'rgba(13,17,23,0.97)'
      : 'rgba(13,17,23,0.85)';
  });
}

// ─── Smooth scroll for nav links ───────────────────────────

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ─── Intersection observer for section reveal ──────────────

function initReveal() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.step-card, .algo-card').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });
}

// ─── Boot ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildHeroBoard();
  initTabs();
  initPasswordToggles();
  initEncBoard();
  initClipboardButtons();
  initNavbar();
  initSmoothScroll();
  initReveal();

  // Board sizing — explicit pixel squares
  resizeBoards();
  window.addEventListener('resize', resizeBoards);

  // How-It-Works animated demos
  watchDemo('demo-1', runDemo1);
  watchDemo('demo-2', runDemo2);
  watchDemo('demo-3', runDemo3);

  document.getElementById('encrypt-btn').addEventListener('click', handleEncrypt);
  document.getElementById('decrypt-btn').addEventListener('click', handleDecrypt);

  // Allow Enter in key field to trigger encrypt/decrypt
  document.getElementById('enc-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleEncrypt();
  });
  document.getElementById('dec-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleDecrypt();
  });
});
