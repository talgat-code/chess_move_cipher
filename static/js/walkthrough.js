/* ============================================================
   Chess Move Cipher — Walkthrough / Step-by-Step Trace
   ============================================================ */

'use strict';

// ─── Arrow layer (SVG overlay on chess board) ───────────────

class ArrowLayer {
  constructor(svgEl, boardEl) {
    this.svg   = svgEl;
    this.board = boardEl;
  }

  _sync() {
    const w = this.board.offsetWidth;
    const h = this.board.offsetHeight;
    this.svg.setAttribute('width',  w);
    this.svg.setAttribute('height', h);
    this.svg.style.width  = w + 'px';
    this.svg.style.height = h + 'px';
  }

  clear() {
    // Keep <defs>, remove everything else
    [...this.svg.children].forEach(c => { if (c.tagName !== 'defs') c.remove(); });
  }

  _sqCenter(sq) {
    const sqSize = this.board.offsetWidth / 8;
    const fi = 'abcdefgh'.indexOf(sq[0]);
    const ri = 8 - parseInt(sq[1]);
    return { x: fi * sqSize + sqSize / 2, y: ri * sqSize + sqSize / 2, sqSize };
  }

  draw(uci, type) {
    const from = uci.slice(0, 2);
    const to   = uci.slice(2, 4);
    const fc   = this._sqCenter(from);
    const tc   = this._sqCenter(to);
    const sq   = fc.sqSize;

    const dx = tc.x - fc.x, dy = tc.y - fc.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;
    const nx = dx / len, ny = dy / len;
    const pad = sq * 0.22;

    const CFG = {
      legal:    { color: 'rgba(100,130,220,0.55)', width: 1.8, marker: 'mh-legal',    opacity: 0.9 },
      usable:   { color: 'rgba(50,210,80,0.85)',   width: 3.2, marker: 'mh-usable',   opacity: 1 },
      selected: { color: 'rgba(212,168,67,1)',      width: 5,   marker: 'mh-selected', opacity: 1 },
      dim:      { color: 'rgba(90,90,90,0.3)',      width: 1.5, marker: 'mh-dim',      opacity: 0.6 },
    };
    const cfg = CFG[type] || CFG.legal;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fc.x + nx * pad);
    line.setAttribute('y1', fc.y + ny * pad);
    line.setAttribute('x2', tc.x - nx * (pad * 1.6));
    line.setAttribute('y2', tc.y - ny * (pad * 1.6));
    line.setAttribute('stroke', cfg.color);
    line.setAttribute('stroke-width', cfg.width);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#${cfg.marker})`);
    line.setAttribute('opacity', cfg.opacity);
    this.svg.appendChild(line);
  }

  renderForStep(step) {
    this._sync();
    this.clear();

    const legal   = step.legal_moves   || [];
    const usable  = step.usable_moves  || [];
    const keyed   = step.keyed_moves   || [];
    const sel     = step.selected_move || step.played_move;

    switch (step.type) {
      case 'legal_moves':
        legal.forEach(m => this.draw(m, 'legal'));
        break;

      case 'hmac_scored':
        keyed.slice(0, 4).forEach(m => this.draw(m, 'usable'));
        keyed.slice(4).forEach(m => this.draw(m, 'dim'));
        break;

      case 'usable_moves':
        usable.forEach(m => this.draw(m, 'usable'));
        keyed.slice(usable.length).forEach(m => this.draw(m, 'dim'));
        break;

      case 'bit_reading':
        usable.forEach(m => this.draw(m, 'usable'));
        break;

      case 'move_selected':
        usable.filter(m => m !== sel).forEach(m => this.draw(m, 'usable'));
        if (sel) this.draw(sel, 'selected');
        break;

      case 'move_decode':
        usable.filter(m => m !== sel).forEach(m => this.draw(m, 'usable'));
        if (sel) this.draw(sel, 'selected');
        break;

      default:
        break;
    }
  }
}

// ─── Step body renderers ────────────────────────────────────

const CHAR_COLORS = [
  'rgba(212,168,67',   'rgba(240,160,48',  'rgba(180,120,30',
  'rgba(232,192,96',   'rgba(200,140,40',  'rgba(250,200,80',
  'rgba(160,100,20',   'rgba(220,180,60',
];

function charColor(i) { return CHAR_COLORS[i % CHAR_COLORS.length]; }

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function kv(k, v, mono = false) {
  return `<div class="wt-k">${k}</div><div class="wt-v${mono ? ' mono' : ''}">${v}</div>`;
}

function renderBinaryRow(binary) {
  return binary.split('').map((b, i) =>
    `<div class="wt-bit" style="animation-delay:${i * 40}ms">${b}</div>`
  ).join('');
}

function renderMoveList(moves, usable = [], selected = '') {
  return moves.map(m => {
    let cls = 'wt-move-chip';
    if (m === selected) cls += ' selected';
    else if (usable.includes(m)) cls += ' usable';
    return `<span class="${cls}">${m}</span>`;
  }).join('');
}

const STEP_RENDERERS = {

  intro(step) {
    return `
      <div class="wt-info-heading">Message → Bits → Chess Moves</div>
      <p class="wt-info-p">This trace will walk you through every single operation the cipher performs to encrypt your message.</p>
      <div class="wt-kv-grid">
        ${kv('Message', `"${step.message}"`)}
        ${kv('Key', step.key_display, true)}
        ${kv('Size', `${step.total_bytes} bytes = <strong style="color:var(--gold)">${step.total_bits} bits</strong> to encode`)}
      </div>
      <p class="wt-info-p" style="color:var(--text-dim)">Use ▶ or the Next button to step through the algorithm.</p>`;
  },

  header(step) {
    const len = step.length_bytes;
    const bits = step.header_bits;
    const grouped = bits.match(/.{1,8}/g).join(' ');
    return `
      <div class="wt-info-heading">32-bit Length Header</div>
      <p class="wt-info-p">Before the message bits we prepend the message length in bytes as a 32-bit big-endian integer.
      This tells the decoder exactly when to stop reading.</p>
      <div class="wt-kv-grid">
        ${kv('length', `${len} bytes`)}
        ${kv('binary (32 bits)', grouped, true)}
      </div>
      <div class="wt-formula">format(${len}, "032b") → ${bits.slice(0,16)}…</div>`;
  },

  char_to_bits(step) {
    return `
      <div class="wt-info-heading">Character → Binary</div>
      <div class="wt-char-conv">
        <div class="wt-conv-box">
          <div class="wt-conv-val">${step.char === '<' ? '&lt;' : step.char}</div>
          <div class="wt-conv-label">character</div>
        </div>
        <div class="wt-conv-arrow">→</div>
        <div class="wt-conv-box">
          <div class="wt-conv-val sm">${step.ascii}</div>
          <div class="wt-conv-label">UTF-8 / ASCII</div>
        </div>
        <div class="wt-conv-arrow">→</div>
        <div class="wt-conv-box">
          <div class="wt-conv-val binary-val">${step.binary}</div>
          <div class="wt-conv-label">8 bits</div>
        </div>
      </div>
      <div class="wt-binary-row">${renderBinaryRow(step.binary)}</div>
      <p class="wt-info-p" style="font-size:0.82rem;color:var(--text-dim)">
        <code>${step.char}</code> has ASCII code <strong>${step.ascii}</strong>.
        In binary: <code>${step.binary.slice(0,4)}</code> <code>${step.binary.slice(4)}</code>
      </p>`;
  },

  bitstream_complete(step) {
    return `
      <div class="wt-info-heading">Bit stream assembled</div>
      <p class="wt-info-p">The full bit stream is ready. It contains:</p>
      <div class="wt-kv-grid">
        ${kv('Header', '32 bits (message length)')}
        ${kv('Payload', `${step.total_bytes * 8} bits (${step.total_bytes} bytes × 8)`)}
        ${kv('Total', `<strong style="color:var(--gold)">${step.bits.length} bits</strong>`)}
      </div>
      <p class="wt-info-p">Now the cipher will start playing chess moves to encode these bits one chunk at a time.</p>`;
  },

  legal_moves(step) {
    const preview = (step.legal_moves || []).slice(0, 16);
    const extra   = step.legal_count - preview.length;
    return `
      <div class="wt-info-heading">${step.legal_count} Legal Moves Available</div>
      <p class="wt-info-p">All ${step.legal_count} moves that can be legally played from this position are shown on the board (blue arrows).</p>
      <div class="wt-move-list">${renderMoveList(preview)}</div>
      ${extra > 0 ? `<p style="font-size:0.78rem;color:var(--text-dim)">… and ${extra} more moves</p>` : ''}
      <p class="wt-info-p">Next: sort them by HMAC to create a secret, key-dependent ordering.</p>`;
  },

  hmac_scored(step) {
    const rows = (step.scored_moves || []).map((m, i) => {
      const usable = i < (step.usable_count || 4);
      return `<tr class="${usable ? 'usable-row' : ''}">
        <td class="wt-rank-cell">${i + 1}</td>
        <td class="wt-move-cell">${m.move}</td>
        <td class="wt-score-cell">${m.score_short}</td>
        <td class="wt-badge-cell"></td>
      </tr>`;
    }).join('');
    const extra = (step.scored_total || 0) - (step.scored_moves || []).length;
    return `
      <div class="wt-info-heading">HMAC-SHA256 Ordering</div>
      <div class="wt-formula">score(move) = HMAC-SHA256(key, FEN + "|" + move.uci())</div>
      <p class="wt-info-p">Every legal move gets a unique HMAC score based on the current position and key.
      Moves are sorted by this score — only the key holder can reproduce this ordering.</p>
      <table class="wt-hmac-table">
        <thead><tr><th>#</th><th>Move</th><th>HMAC Score</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${extra > 0 ? `<p style="font-size:0.75rem;color:var(--text-dim)">… and ${extra} more</p>` : ''}`;
  },

  usable_moves(step) {
    const { k, usable_count, legal_count } = step;
    const usable  = step.usable_moves || [];
    const keyed   = step.keyed_moves  || [];
    const nonUsable = keyed.slice(usable_count);
    return `
      <div class="wt-info-heading">Selecting Usable Moves</div>
      <div class="wt-k-formula">
        <div class="wt-k-line">k = ⌊log₂(<strong>${legal_count}</strong>)⌋ = <strong>${k}</strong></div>
        <div class="wt-k-line">usable = 2<sup>${k}</sup> = <em>${usable_count}</em> moves</div>
        <div class="wt-k-line">capacity = <strong>${k} bits</strong> per move</div>
      </div>
      <p class="wt-info-p">We use exactly 2<sup>k</sup> moves so that bit chunks of length k map cleanly to indices 0–${usable_count - 1}.</p>
      <div class="wt-move-list">
        ${renderMoveList(usable, usable)}
        ${nonUsable.length ? `<span style="color:var(--text-dim);font-size:0.78rem;padding:4px"> ··· ${nonUsable.length} not used</span>` : ''}
      </div>`;
  },

  bit_reading(step) {
    const { k, chunk, move_index, bit_index } = step;
    return `
      <div class="wt-info-heading">Reading ${k} Bits from Stream</div>
      <p class="wt-info-p">Taking ${k} bits starting at position <code>${bit_index}</code>:</p>
      <div class="wt-chunk-display">
        <div class="wt-chunk-bits">${chunk}</div>
        <div class="wt-chunk-eq">= ${move_index} (decimal)</div>
        <div class="wt-chunk-idx">→ index <strong>${move_index}</strong></div>
      </div>
      <p class="wt-info-p">This selects <code>secret_moves[${move_index}]</code> from the HMAC-sorted list.</p>
      <div class="wt-move-list">${renderMoveList(step.usable_moves || [], step.usable_moves || [])}</div>`;
  },

  move_selected(step) {
    const { chunk, move_index, selected_move, k } = step;
    return `
      <div class="wt-info-heading">Move Selected: ${selected_move}</div>
      <div class="wt-chunk-display">
        <div class="wt-chunk-bits">${chunk}</div>
        <div class="wt-chunk-eq">= ${move_index}</div>
        <div class="wt-chunk-idx">→ <strong style="color:var(--gold)">${selected_move}</strong></div>
      </div>
      <p class="wt-info-p">Bits <strong style="color:var(--gold)">"${chunk}"</strong> select <code>secret_moves[${move_index}]</code> = <strong>${selected_move}</strong>.</p>
      <p class="wt-info-p">This move encodes exactly ${k} bits of your message while appearing as a perfectly legal chess move.</p>
      <div class="wt-move-list">${renderMoveList(step.usable_moves || [], step.usable_moves || [], selected_move)}</div>`;
  },

  move_played(step) {
    const pct = Math.round((step.bits_encoded / step.bits_total) * 100);
    return `
      <div class="wt-info-heading">Move Played: ${step.played_move}</div>
      <div class="wt-enc-progress"><div class="wt-enc-progress-fill" style="width:${pct}%"></div></div>
      <div class="wt-kv-grid">
        ${kv('Bits encoded', `${step.bits_encoded} / ${step.bits_total} (${pct}%)`)}
        ${kv('Bits remaining', step.bits_total - step.bits_encoded)}
      </div>
      <p class="wt-info-p">The board advances to the new position. The process repeats for the next chunk of bits.</p>`;
  },

  complete(step) {
    return `
      <div class="wt-success-box">
        <div class="wt-success-icon">♟</div>
        <div class="wt-info-heading" style="color:#7ee787">Encryption Complete!</div>
        <div class="wt-kv-grid" style="margin-top:14px">
          ${kv('Total moves',  step.total_moves)}
          ${kv('Total bits',   step.total_bits)}
          ${kv('Games',        step.games)}
        </div>
        <p class="wt-info-p">All ${step.total_bits} bits have been encoded into chess moves. The resulting PGN looks like a perfectly normal chess game.</p>
      </div>`;
  },

  decrypt_intro(step) {
    return `
      <div class="wt-info-heading">Decryption Trace</div>
      <p class="wt-info-p">Reading the chess moves from the PGN and extracting the hidden bits from each one.</p>
      <div class="wt-kv-grid">
        ${kv('Games',  step.game_count)}
        ${kv('Moves',  step.total_moves)}
      </div>
      <p class="wt-info-p">For each move, the cipher will determine its secret index in the HMAC-sorted list, convert that index to bits, and accumulate them until the full message is recovered.</p>`;
  },

  move_decode(step) {
    const { played_move, move_index, chunk, k } = step;
    return `
      <div class="wt-info-heading">Decoding Move: ${played_move}</div>
      <p class="wt-info-p">The played move <strong style="color:var(--gold)">${played_move}</strong> appears at position <strong>${move_index}</strong> in the secret ordering.</p>
      <div class="wt-chunk-display">
        <div class="wt-chunk-bits">${played_move}</div>
        <div class="wt-chunk-eq">→ index ${move_index}</div>
        <div class="wt-chunk-idx"><strong style="color:#79c0ff">"${chunk}"</strong></div>
      </div>
      <p class="wt-info-p">Index <strong>${move_index}</strong> in ${k}-bit binary = <strong style="color:#79c0ff">"${chunk}"</strong>. Appended to the bit stream.</p>
      <div class="wt-move-list">${renderMoveList(step.usable_moves || [], step.usable_moves || [], played_move)}</div>`;
  },

  bits_accumulated(step) {
    const exp = step.expected_total;
    const got = step.bits ? step.bits.length : 0;
    const pct  = exp ? Math.min(100, Math.round(got / exp * 100)) : 0;
    return `
      <div class="wt-info-heading">Bits Accumulated: ${got}</div>
      ${exp ? `<div class="wt-enc-progress"><div class="wt-enc-progress-fill" style="width:${pct}%"></div></div>` : ''}
      <div class="wt-kv-grid">
        ${kv('Extracted so far', got + ' bits')}
        ${exp ? kv('Expected total', exp + ' bits') : ''}
        ${got >= 32 ? kv('Message length', `${Math.floor((exp - 32) / 8)} bytes (from header)`) : ''}
      </div>
      <p class="wt-info-p">${exp && got >= exp ? 'All bits collected! Ready to decode the message.' : 'Continuing to the next move…'}</p>`;
  },

  new_game(step) {
    return `
      <div class="wt-info-heading">Starting New Game</div>
      <p class="wt-info-p">The previous game exhausted its encoding capacity. The board is reset to the starting position and a new game begins.</p>
      <p class="wt-info-p" style="color:var(--text-dim)">Multiple games in a single .cpgn file are perfectly normal — the decoder reads them in sequence.</p>`;
  },

  decrypt_complete(step) {
    return `
      <div class="wt-success-box">
        <div class="wt-success-icon">🔓</div>
        <div class="wt-info-heading" style="color:#7ee787">Decryption Complete!</div>
        <div class="wt-success-msg">${step.message}</div>
        <div class="wt-kv-grid" style="margin-top:10px">
          ${kv('Moves processed', step.total_moves)}
        </div>
      </div>`;
  },
};

function renderStepBody(step) {
  const fn = STEP_RENDERERS[step.type] || (() => `<p>Step type: <code>${step.type}</code></p>`);
  document.getElementById('wt-step-body').innerHTML = fn(step);
}

// ─── Bit stream renderer ────────────────────────────────────

function renderBitStream(step, message) {
  const el    = document.getElementById('wt-bitstream');
  const info  = document.getElementById('wt-bs-info');
  const bits  = step.bits || '';
  const hl    = step.bit_highlight;
  const cur   = step.bit_index || 0;

  // Build groups: header + per-character
  const groups = [];
  if (bits.length > 0) {
    groups.push({ label: 'len', bits: bits.slice(0, 32), type: 'hdr', start: 0 });
    const msgBytes = message ? message.length : 0;
    let offset = 32;
    for (let i = 0; i < msgBytes && offset < bits.length; i++) {
      const ch = message[i] || '?';
      const b  = bits.slice(offset, offset + 8);
      if (b.length > 0) {
        groups.push({ label: ch === ' ' ? '·' : ch, bits: b, type: 'chr', colorIdx: i, start: offset });
      }
      offset += 8;
    }
    // Remaining bits (padding or decryption accumulation)
    if (offset < bits.length) {
      groups.push({ label: '…', bits: bits.slice(offset), type: 'chr', colorIdx: msgBytes, start: offset });
    }
  }

  // Render
  let html = '';
  for (const g of groups) {
    const active = hl && g.start < hl[1] && g.start + g.bits.length > hl[0];
    const done   = cur > g.start + g.bits.length;
    let style = '';
    if (g.type === 'chr') {
      const ci = g.colorIdx % CHAR_COLORS.length;
      style = `background:${CHAR_COLORS[ci]},0.12);border:1px solid ${CHAR_COLORS[ci]},0.35);color:${CHAR_COLORS[ci]},0.9)`;
    }
    const cls = ['wt-bs-block', g.type, active ? 'active' : '', done ? 'read' : ''].filter(Boolean).join(' ');
    html += `<div class="wt-bs-group">
      <span class="${cls}" style="${style}" title="bits ${g.start}–${g.start + g.bits.length - 1}">${g.bits}</span>
      <span class="wt-bs-label">${g.label}</span>
    </div>`;
  }

  el.innerHTML = html;

  // Scroll active block into view
  const active = el.querySelector('.wt-bs-block.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  const total = bits.length;
  info.textContent = total > 0 ? `${cur} / ${total} bits read` : '';
}

// ─── Step dots ─────────────────────────────────────────────

function renderDots(count, current) {
  const el  = document.getElementById('wt-step-dots');
  const MAX = 60;
  if (count > MAX) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = Array.from({ length: count }, (_, i) =>
    `<div class="wt-dot${i < current ? ' done' : ''}${i === current ? ' active' : ''}" data-idx="${i}"></div>`
  ).join('');
  el.querySelectorAll('.wt-dot').forEach(d => {
    d.addEventListener('click', () => player && player.goto(parseInt(d.dataset.idx)));
  });
}

// ─── Badge label map ────────────────────────────────────────

const BADGE_LABELS = {
  intro:              'Intro',
  header:             'Header',
  char_to_bits:       'Text → Bits',
  bitstream_complete: 'Bit Stream',
  legal_moves:        'Legal Moves',
  hmac_scored:        'HMAC Sort',
  usable_moves:       'Usable Moves',
  bit_reading:        'Read Bits',
  move_selected:      'Move Selected',
  move_played:        'Move Played',
  complete:           'Complete ✓',
  decrypt_intro:      'Intro',
  move_decode:        'Decode Move',
  bits_accumulated:   'Bits +',
  new_game:           'New Game',
  decrypt_complete:   'Complete ✓',
};

const SHOW_LEGEND = new Set(['legal_moves','hmac_scored','usable_moves','bit_reading','move_selected','move_decode']);

// ─── Walkthrough Player ─────────────────────────────────────

class WalkthroughPlayer {
  constructor(steps, message) {
    this.steps   = steps;
    this.message = message;
    this.index   = 0;
    this.playing = false;
    this.speed   = 2500;
    this.timer   = null;

    this.board  = new ChessBoard('trace-board');
    this.arrows = new ArrowLayer(
      document.getElementById('board-svg'),
      document.getElementById('trace-board')
    );

    const slider = document.getElementById('wt-slider');
    slider.max   = steps.length - 1;
    slider.value = 0;
    slider.addEventListener('input', () => this.goto(parseInt(slider.value)));

    document.getElementById('wt-first').addEventListener('click', () => { this.pause(); this.goto(0); });
    document.getElementById('wt-prev').addEventListener('click',  () => { this.pause(); this.goto(this.index - 1); });
    document.getElementById('wt-play').addEventListener('click',  () => this.togglePlay());
    document.getElementById('wt-next').addEventListener('click',  () => { this.pause(); this.goto(this.index + 1); });
    document.getElementById('wt-last').addEventListener('click',  () => { this.pause(); this.goto(steps.length - 1); });

    document.querySelectorAll('.wt-speed').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wt-speed').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.speed = parseInt(btn.dataset.ms);
        if (this.playing) { this.pause(); this.play(); }
      });
    });

    this.render();
    resizeBoards();
    // re-sync SVG size after board is sized
    setTimeout(() => { this.arrows._sync(); }, 100);
    window.addEventListener('resize', () => { resizeBoards(); this.arrows.renderForStep(this.steps[this.index]); });
  }

  goto(i) {
    this.index = Math.max(0, Math.min(i, this.steps.length - 1));
    this.render();
  }

  togglePlay() { this.playing ? this.pause() : this.play(); }

  play() {
    this.playing = true;
    const btn = document.getElementById('wt-play');
    btn.textContent = '⏸';
    btn.classList.add('is-playing');
    this.timer = setInterval(() => {
      if (this.index >= this.steps.length - 1) { this.pause(); return; }
      this.goto(this.index + 1);
    }, this.speed);
  }

  pause() {
    this.playing = false;
    clearInterval(this.timer);
    const btn = document.getElementById('wt-play');
    btn.textContent = '▶';
    btn.classList.remove('is-playing');
  }

  render() {
    const step = this.steps[this.index];

    // Board + arrows
    this.board.setFEN(step.fen || chess_STARTING_FEN());
    this.arrows.renderForStep(step);

    // Step bar
    document.getElementById('wt-step-num').textContent   = this.index + 1;
    document.getElementById('wt-step-total').textContent = this.steps.length;
    document.getElementById('wt-step-title').textContent = step.title || '';

    const badge = document.getElementById('wt-step-badge');
    badge.textContent = BADGE_LABELS[step.type] || step.type;
    badge.className   = `wt-step-badge type-${step.type}`;

    // Dots
    renderDots(this.steps.length, this.index);

    // Slider
    document.getElementById('wt-slider').value = this.index;

    // Legend
    const legend = document.getElementById('wt-legend');
    legend.style.display = SHOW_LEGEND.has(step.type) ? 'flex' : 'none';

    // Info panel
    renderStepBody(step);

    // Bit stream
    renderBitStream(step, this.message);
  }
}

function chess_STARTING_FEN() {
  return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
}

// ─── Mode tabs ──────────────────────────────────────────────

let currentMode = 'encrypt';
let player = null;

function initModeTabs() {
  document.querySelectorAll('.wt-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentMode = tab.dataset.mode;
      document.querySelectorAll('.wt-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('wt-enc-form').style.display = currentMode === 'encrypt' ? 'block' : 'none';
      document.getElementById('wt-dec-form').style.display = currentMode === 'decrypt' ? 'block' : 'none';
    });
  });
}

// ─── Run trace ──────────────────────────────────────────────

async function runTrace(mode) {
  const loading  = document.getElementById('wt-loading');
  const errEl    = document.getElementById(mode === 'encrypt' ? 'wt-enc-error' : 'wt-dec-error');
  errEl.style.display = 'none';

  let body = { mode, key: '' };
  let message = '';

  if (mode === 'encrypt') {
    message  = (document.getElementById('wt-message').value || '').trim();
    body.key = (document.getElementById('wt-key-enc').value || '').trim();
    body.message = message;
    if (!message) { errEl.textContent = 'Please enter a message.'; errEl.style.display = 'block'; return; }
    if (!body.key) { errEl.textContent = 'Please enter a key.'; errEl.style.display = 'block'; return; }
  } else {
    body.pgn = (document.getElementById('wt-pgn').value || '').trim();
    body.key = (document.getElementById('wt-key-dec').value || '').trim();
    if (!body.pgn) { errEl.textContent = 'Please paste PGN data.'; errEl.style.display = 'block'; return; }
    if (!body.key) { errEl.textContent = 'Please enter a key.'; errEl.style.display = 'block'; return; }
  }

  loading.style.display = 'flex';
  if (player) player.pause();

  try {
    const res  = await fetch('/api/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      errEl.textContent  = data.error || 'Trace failed.';
      errEl.style.display = 'block';
      return;
    }

    // Show viewer
    document.getElementById('wt-viewer').style.display = 'block';
    document.getElementById('wt-viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });

    player = new WalkthroughPlayer(data.steps, message);

  } catch (err) {
    errEl.textContent  = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  } finally {
    loading.style.display = 'none';
  }
}

// ─── Boot ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initModeTabs();

  document.getElementById('wt-run-enc').addEventListener('click', () => runTrace('encrypt'));
  document.getElementById('wt-run-dec').addEventListener('click', () => runTrace('decrypt'));

  // Enter key in message field
  document.getElementById('wt-message').addEventListener('keydown', e => {
    if (e.key === 'Enter') runTrace('encrypt');
  });
});
