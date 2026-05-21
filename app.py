from flask import Flask, render_template, request, jsonify
import chess
import hashlib
import hmac as hmac_lib
import math
import os
from main import ChessCipherEncoder, ChessCipherDecoder, BitConverter, MoveOracle

app = Flask(__name__)


# ─── Main pages ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/walkthrough")
def walkthrough():
    return render_template("walkthrough.html")


# ─── Cipher API ─────────────────────────────────────────────

@app.route("/api/encrypt", methods=["POST"])
def encrypt():
    data = request.get_json()
    message = (data.get("message") or "").strip()
    key     = (data.get("key") or "").strip()

    if not message:
        return jsonify({"error": "Message is required"}), 400
    if not key:
        return jsonify({"error": "Key is required"}), 400

    try:
        encoder = ChessCipherEncoder(key)
        games, steps, bits = encoder.encrypt_to_games(message, collect_steps=True)
        pgn = encoder.games_to_pgn(games)
        return jsonify({
            "success": True,
            "games": games,
            "steps": steps,
            "bits": bits,
            "pgn": pgn,
            "game_count": len(games),
            "move_count": sum(len(g) for g in games),
            "bit_count": len(bits),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/decrypt", methods=["POST"])
def decrypt():
    data = request.get_json()
    pgn_text = (data.get("pgn") or "").strip()
    key      = (data.get("key") or "").strip()

    if not pgn_text:
        return jsonify({"error": "PGN data is required"}), 400
    if not key:
        return jsonify({"error": "Key is required"}), 400

    try:
        decoder = ChessCipherDecoder(key)
        games   = decoder.pgn_to_games(pgn_text)
        if not games:
            return jsonify({"error": "No chess games found in PGN"}), 400
        message = decoder.decrypt_from_games(games)
        return jsonify({"success": True, "message": message})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Trace API ──────────────────────────────────────────────

def _scored_moves(board, key):
    """HMAC-sort all legal moves and return display data."""
    fen = board.fen()
    result = []
    for move in board.legal_moves:
        uci  = move.uci()
        data = (fen + "|" + uci).encode("utf-8")
        score = hmac_lib.new(key.encode("utf-8"), data, hashlib.sha256).hexdigest()
        result.append({"move": uci, "score": score, "score_short": score[:10] + "…"})
    result.sort(key=lambda x: x["score"])
    return result


def _trace_encrypt(message, key):
    oracle    = MoveOracle(key)
    bits      = BitConverter.text_to_bits(message)
    raw_bytes = message.encode("utf-8")
    hdr_bits  = format(len(raw_bytes), "032b")
    steps     = []

    # ── Intro ──
    steps.append({
        "type": "intro", "title": "Ready to encrypt",
        "message": message,
        "key_display": (key[:2] + "•" * max(0, len(key) - 2)) if len(key) > 2 else key,
        "total_bytes": len(raw_bytes), "total_bits": len(bits),
        "fen": chess.STARTING_FEN, "legal_moves": [],
        "bits": bits, "bit_index": 0, "bit_highlight": None,
    })

    # ── 32-bit header ──
    steps.append({
        "type": "header", "title": "Step 1 — Encode message length (32-bit header)",
        "length_bytes": len(raw_bytes), "header_bits": hdr_bits,
        "fen": chess.STARTING_FEN, "legal_moves": [],
        "bits": bits, "bit_index": 0, "bit_highlight": [0, 32],
    })

    # ── Per-character ──
    offset = 32
    for byte in raw_bytes:
        try:
            ch = bytes([byte]).decode("utf-8")
        except Exception:
            ch = f"\\x{byte:02x}"
        binary = format(byte, "08b")
        steps.append({
            "type": "char_to_bits",
            "title": f"Step 1 — Encode '{ch}' to binary",
            "char": ch, "ascii": byte, "binary": binary,
            "fen": chess.STARTING_FEN, "legal_moves": [],
            "bits": bits, "bit_index": 0, "bit_highlight": [offset, offset + 8],
        })
        offset += 8

    # ── Full bit stream ──
    steps.append({
        "type": "bitstream_complete", "title": "Step 1 — Bit stream ready",
        "bits": bits, "total_bytes": len(raw_bytes), "hdr_bits": hdr_bits,
        "message": message,
        "fen": chess.STARTING_FEN, "legal_moves": [],
        "bit_index": 0, "bit_highlight": None,
    })

    # ── Game loop ──
    board     = chess.Board()
    bit_index = 0
    move_num  = 0
    game_num  = 1
    MAX_MOVES = 80

    while bit_index < len(bits) and move_num < MAX_MOVES:
        usable_list, k = oracle.get_usable_moves(board)
        legal_list     = list(board.legal_moves)

        if not usable_list:
            board = chess.Board()
            game_num += 1
            steps.append({
                "type": "new_game",
                "title": f"Starting game #{game_num} — no more encoding capacity",
                "fen": chess.STARTING_FEN, "legal_moves": [],
                "bits": bits, "bit_index": bit_index, "bit_highlight": None,
            })
            continue

        legal_ucis  = [m.uci() for m in legal_list]
        usable_ucis = [m.uci() for m in usable_list]
        fen_now     = board.fen()

        # Legal moves
        steps.append({
            "type": "legal_moves",
            "title": f"Move {move_num + 1} — All legal moves ({len(legal_list)})",
            "fen": fen_now, "legal_moves": legal_ucis,
            "legal_count": len(legal_list), "move_num": move_num, "game_num": game_num,
            "bits": bits, "bit_index": bit_index, "bit_highlight": None,
        })

        # HMAC scoring
        scored     = _scored_moves(board, key)
        keyed_ucis = [s["move"] for s in scored]
        steps.append({
            "type": "hmac_scored",
            "title": f"Move {move_num + 1} — Sort by HMAC-SHA256(key, FEN|move)",
            "fen": fen_now, "legal_moves": legal_ucis,
            "keyed_moves": keyed_ucis,
            "scored_moves": scored[:14], "scored_total": len(scored),
            "move_num": move_num,
            "bits": bits, "bit_index": bit_index, "bit_highlight": None,
        })

        # Usable moves
        steps.append({
            "type": "usable_moves",
            "title": f"Move {move_num + 1} — k = ⌊log₂({len(legal_list)})⌋ = {k}, use {len(usable_ucis)} moves",
            "fen": fen_now, "legal_moves": legal_ucis,
            "keyed_moves": keyed_ucis, "usable_moves": usable_ucis,
            "k": k, "usable_count": len(usable_ucis), "legal_count": len(legal_list),
            "move_num": move_num,
            "bits": bits, "bit_index": bit_index, "bit_highlight": None,
        })

        # Bit reading
        chunk     = bits[bit_index:bit_index + k].ljust(k, "0")
        move_idx  = int(chunk, 2)
        steps.append({
            "type": "bit_reading",
            "title": f"Move {move_num + 1} — Read {k} bits → \"{chunk}\" = {move_idx}",
            "fen": fen_now, "legal_moves": legal_ucis,
            "usable_moves": usable_ucis, "k": k,
            "chunk": chunk, "move_index": move_idx,
            "bits": bits, "bit_index": bit_index,
            "bit_highlight": [bit_index, bit_index + k],
        })

        # Move selected
        selected_uci = usable_ucis[move_idx]
        steps.append({
            "type": "move_selected",
            "title": f"Move {move_num + 1} — Selected: {selected_uci}",
            "fen": fen_now, "legal_moves": legal_ucis,
            "usable_moves": usable_ucis, "selected_move": selected_uci,
            "k": k, "chunk": chunk, "move_index": move_idx,
            "bits": bits, "bit_index": bit_index,
            "bit_highlight": [bit_index, bit_index + k],
        })

        # Play move
        board.push(chess.Move.from_uci(selected_uci))
        bit_index += k
        move_num  += 1

        steps.append({
            "type": "move_played",
            "title": f"Played {selected_uci} — {bit_index}/{len(bits)} bits encoded",
            "fen": board.fen(), "legal_moves": [],
            "played_move": selected_uci,
            "bits_encoded": bit_index, "bits_total": len(bits),
            "bits": bits, "bit_index": bit_index, "bit_highlight": None,
        })

    steps.append({
        "type": "complete", "title": "✓ Encryption complete!",
        "fen": board.fen(), "legal_moves": [],
        "total_moves": move_num, "total_bits": len(bits), "games": game_num,
        "bits": bits, "bit_index": len(bits), "bit_highlight": None,
    })
    return steps


def _trace_decrypt(pgn_text, key):
    oracle  = MoveOracle(key)
    decoder = ChessCipherDecoder(key)
    games   = decoder.pgn_to_games(pgn_text)
    if not games:
        raise ValueError("No games found in PGN")

    steps     = []
    bits      = ""
    expected  = None
    move_num  = 0
    MAX_MOVES = 80

    steps.append({
        "type": "decrypt_intro", "title": "Starting decryption",
        "game_count": len(games),
        "total_moves": sum(len(g) for g in games),
        "fen": chess.STARTING_FEN, "legal_moves": [],
        "bits": "", "bit_index": 0, "bit_highlight": None,
    })

    done = False
    for game_num, game_moves in enumerate(games, 1):
        if done or move_num >= MAX_MOVES:
            break
        board = chess.Board()

        for move_text in game_moves:
            if done or move_num >= MAX_MOVES:
                break
            move        = chess.Move.from_uci(move_text)
            usable_list, k = oracle.get_usable_moves(board)
            legal_list  = list(board.legal_moves)

            if not usable_list:
                raise ValueError(f"No usable moves at move {move_num + 1}")

            legal_ucis  = [m.uci() for m in legal_list]
            usable_ucis = [m.uci() for m in usable_list]
            fen_now     = board.fen()

            steps.append({
                "type": "legal_moves",
                "title": f"Move {move_num + 1} — All legal moves ({len(legal_list)})",
                "fen": fen_now, "legal_moves": legal_ucis,
                "legal_count": len(legal_list), "move_num": move_num,
                "bits": bits, "bit_index": len(bits), "bit_highlight": None,
            })

            scored     = _scored_moves(board, key)
            keyed_ucis = [s["move"] for s in scored]
            steps.append({
                "type": "hmac_scored",
                "title": f"Move {move_num + 1} — Sort by HMAC key",
                "fen": fen_now, "legal_moves": legal_ucis,
                "keyed_moves": keyed_ucis,
                "scored_moves": scored[:14], "scored_total": len(scored),
                "move_num": move_num,
                "bits": bits, "bit_index": len(bits), "bit_highlight": None,
            })

            steps.append({
                "type": "usable_moves",
                "title": f"Move {move_num + 1} — k={k}, {len(usable_ucis)} usable moves",
                "fen": fen_now, "legal_moves": legal_ucis,
                "keyed_moves": keyed_ucis, "usable_moves": usable_ucis,
                "k": k, "usable_count": len(usable_ucis), "legal_count": len(legal_list),
                "move_num": move_num,
                "bits": bits, "bit_index": len(bits), "bit_highlight": None,
            })

            if move_text not in usable_ucis:
                raise ValueError(f"Wrong key or corrupted file. Move {move_text} not in usable list.")

            move_idx = usable_ucis.index(move_text)
            chunk    = format(move_idx, f"0{k}b")
            bit_start = len(bits)

            steps.append({
                "type": "move_decode",
                "title": f"Move {move_num + 1} — {move_text} is index {move_idx} → bits \"{chunk}\"",
                "fen": fen_now, "legal_moves": legal_ucis,
                "usable_moves": usable_ucis, "played_move": move_text,
                "move_index": move_idx, "chunk": chunk, "k": k,
                "bits": bits, "bit_index": len(bits),
                "bit_highlight": [bit_start, bit_start + k],
            })

            bits += chunk

            if expected is None and len(bits) >= 32:
                msg_len  = int(bits[:32], 2)
                expected = 32 + msg_len * 8

            steps.append({
                "type": "bits_accumulated",
                "title": f"Move {move_num + 1} — Extracted \"{chunk}\", total {len(bits)} bits",
                "fen": fen_now, "legal_moves": [],
                "played_move": move_text, "chunk": chunk, "k": k,
                "bits": bits, "bit_index": len(bits),
                "expected_total": expected,
                "bit_highlight": [bit_start, bit_start + k],
            })

            board.push(move)
            move_num += 1

            if expected and len(bits) >= expected:
                done = True
                break

    message = BitConverter.bits_to_text(bits[:expected]) if expected and len(bits) >= expected else "(incomplete)"
    steps.append({
        "type": "decrypt_complete", "title": "✓ Decryption complete!",
        "fen": board.fen(), "legal_moves": [],
        "message": message, "total_moves": move_num,
        "bits": bits, "bit_index": expected or len(bits), "bit_highlight": None,
    })
    return steps


@app.route("/api/trace", methods=["POST"])
def trace():
    data    = request.get_json()
    key     = (data.get("key") or "").strip()
    mode    = data.get("mode", "encrypt")

    if not key:
        return jsonify({"error": "Key is required"}), 400

    try:
        if mode == "encrypt":
            message = (data.get("message") or "").strip()
            if not message:
                return jsonify({"error": "Message is required"}), 400
            if len(message) > 40:
                return jsonify({"error": "Keep the message under 40 characters for the trace view"}), 400
            steps = _trace_encrypt(message, key)
            return jsonify({"success": True, "steps": steps})

        elif mode == "decrypt":
            pgn_text = (data.get("pgn") or "").strip()
            if not pgn_text:
                return jsonify({"error": "PGN data is required"}), 400
            steps = _trace_decrypt(pgn_text, key)
            return jsonify({"success": True, "steps": steps})

        return jsonify({"error": "Invalid mode"}), 400

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", "5050"))
    app.run(debug=debug, host=host, port=port)
