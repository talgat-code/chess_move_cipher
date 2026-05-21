from flask import Flask, render_template, request, jsonify
from main import ChessCipherEncoder, ChessCipherDecoder, BitConverter

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/encrypt", methods=["POST"])
def encrypt():
    data = request.get_json()
    message = data.get("message", "").strip()
    key = data.get("key", "").strip()

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
    pgn_text = data.get("pgn", "").strip()
    key = data.get("key", "").strip()

    if not pgn_text:
        return jsonify({"error": "PGN data is required"}), 400
    if not key:
        return jsonify({"error": "Key is required"}), 400

    try:
        decoder = ChessCipherDecoder(key)
        games = decoder.pgn_to_games(pgn_text)

        if not games:
            return jsonify({"error": "No chess games found in PGN"}), 400

        message = decoder.decrypt_from_games(games)

        return jsonify({
            "success": True,
            "message": message,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=5050)
