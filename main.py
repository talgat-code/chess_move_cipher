import chess
import chess.pgn
import hashlib
import hmac
import io
import math
import os


# ============================================================
# 1. Работа с битами
# ============================================================


class BitConverter:
    """Конвертирует текст в поток битов и обратно."""

    @staticmethod
    def text_to_bits(text):
        """
        Переводит обычный текст в поток битов.

        Формат:
        [32 бита длины сообщения] + [биты самого сообщения]
        """

        data = text.encode("utf-8")
        length = len(data)

        # Первые 32 бита — длина сообщения в байтах
        bits = format(length, "032b")

        # Каждый байт сообщения переводим в 8 бит
        for byte in data:
            bits += format(byte, "08b")

        return bits

    @staticmethod
    def bits_to_text(bits):
        """Переводит поток битов обратно в текст."""

        if len(bits) < 32:
            raise ValueError("Недостаточно битов для чтения длины сообщения")

        # Первые 32 бита — длина сообщения
        length = int(bits[:32], 2)
        needed_bits = 32 + length * 8

        if len(bits) < needed_bits:
            raise ValueError("Недостаточно битов для восстановления сообщения")

        message_bits = bits[32:needed_bits]

        data = bytearray()
        for i in range(0, len(message_bits), 8):
            byte = message_bits[i : i + 8]
            data.append(int(byte, 2))

        return data.decode("utf-8")


# ============================================================
# 2. Генерация секретного порядка ходов
# ============================================================


class MoveOracle:
    """
    Создаёт секретный порядок легальных ходов на основе ключа.

    Для каждого легального хода считается:
    HMAC-SHA256(key, FEN + "|" + move)

    Потом ходы сортируются по этому HMAC.
    """

    def __init__(self, key):
        self.key = key

    def get_keyed_moves(self, board):
        """Возвращает список легальных ходов, отсортированных по HMAC."""

        legal_moves = list(board.legal_moves)
        position_text = board.fen()

        scored_moves = []

        for move in legal_moves:
            move_text = move.uci()
            data = position_text + "|" + move_text

            score = hmac.new(
                self.key.encode("utf-8"), data.encode("utf-8"), hashlib.sha256
            ).hexdigest()

            scored_moves.append((score, move))

        scored_moves.sort(key=lambda item: item[0])

        return [move for score, move in scored_moves]

    def get_usable_moves(self, board):
        """
        Возвращает:
        usable_moves — ходы, которые можно использовать для кодирования;
        k — сколько бит можно спрятать в одном ходе.

        Если ходов меньше 2, возвращает пустой список и k = 0.
        """

        legal_count = len(list(board.legal_moves))

        if legal_count < 2:
            return [], 0

        k = math.floor(math.log2(legal_count))

        if k < 1:
            return [], 0

        keyed_moves = self.get_keyed_moves(board)
        usable_count = 2 ** k
        usable_moves = keyed_moves[:usable_count]

        return usable_moves, k


# ============================================================
# 3. Шифрование
# ============================================================


class ChessCipherEncoder:
    """Шифрует сообщения в список шахматных партий."""

    def __init__(self, key):
        self.key = key
        self.oracle = MoveOracle(key)

    def encrypt_to_games(self, message, collect_steps=False):
        """
        Шифрует сообщение в список шахматных партий.

        Если текущая партия закончилась или ходов стало недостаточно,
        программа завершает эту партию и начинает новую.

        collect_steps=True — дополнительно возвращает пошаговые данные для визуализации.
        """

        bits = BitConverter.text_to_bits(message)
        games = []
        steps = [] if collect_steps else None
        current_game = []

        board = chess.Board()
        bit_index = 0

        while bit_index < len(bits):
            usable_moves, k = self.oracle.get_usable_moves(board)

            # Если ходов недостаточно, начинаем новую партию
            if len(usable_moves) == 0:
                if current_game:
                    games.append(current_game)
                current_game = []
                board = chess.Board()
                continue

            # Берём следующие k бит
            chunk = bits[bit_index : bit_index + k]

            # Если в конце битов не хватает, добавляем нули
            if len(chunk) < k:
                chunk = chunk.ljust(k, "0")

            # Биты превращаются в индекс хода
            move_index = int(chunk, 2)
            selected_move = usable_moves[move_index]

            if collect_steps:
                steps.append({
                    "fen": board.fen(),
                    "legal_count": len(list(board.legal_moves)),
                    "usable_count": len(usable_moves),
                    "k": k,
                    "bits_encoded": chunk,
                    "move_index": move_index,
                    "move": selected_move.uci(),
                    "bit_position": bit_index,
                })

            current_game.append(selected_move.uci())
            board.push(selected_move)
            bit_index += k

            # Если после хода партия закончилась, а биты ещё остались,
            # сохраняем текущую партию и начинаем новую
            next_usable_moves, _ = self.oracle.get_usable_moves(board)

            if bit_index < len(bits) and len(next_usable_moves) == 0:
                games.append(current_game)
                current_game = []
                board = chess.Board()

        if current_game:
            games.append(current_game)

        if collect_steps:
            return games, steps, bits
        return games

    def games_to_pgn(self, games):
        """
        Превращает список партий в PGN-текст.

        В .cpgn файле будет храниться обычный PGN-текст,
        но с расширением .cpgn.
        """

        pgn_games = []

        for game_number, moves in enumerate(games, start=1):
            game = chess.pgn.Game()

            game.headers["Event"] = "Chess Move Cipher"
            game.headers["Site"] = "Local"
            game.headers["Date"] = "????.??.??"
            game.headers["Round"] = str(game_number)
            game.headers["White"] = "Encoder"
            game.headers["Black"] = "Encoder"

            board = chess.Board()
            node = game

            for move_text in moves:
                move = chess.Move.from_uci(move_text)

                if move not in board.legal_moves:
                    raise ValueError("Нелегальный ход при создании PGN: " + move_text)

                node = node.add_variation(move)
                board.push(move)

            game.headers["Result"] = board.result()

            exporter = chess.pgn.StringExporter(
                headers=True, variations=False, comments=False
            )

            pgn_games.append(game.accept(exporter))

        return "\n\n".join(pgn_games)

    def encrypt_to_cpgn_file(self, message, output_path):
        """Главная функция шифрования в файл .cpgn."""

        if not output_path.endswith(".cpgn"):
            output_path += ".cpgn"

        games = self.encrypt_to_games(message)
        pgn_text = self.games_to_pgn(games)

        with open(output_path, "w", encoding="utf-8") as file:
            file.write(pgn_text)

        return output_path


# ============================================================
# 4. Расшифровка
# ============================================================


class ChessCipherDecoder:
    """Расшифровывает шахматные партии обратно в текст."""

    def __init__(self, key):
        self.key = key
        self.oracle = MoveOracle(key)

    def pgn_to_games(self, pgn_text):
        """
        Читает PGN-текст и возвращает список партий в UCI-формате.

        Каждая новая PGN-партия означает сброс доски.
        """

        pgn_stream = io.StringIO(pgn_text)
        games = []

        while True:
            game = chess.pgn.read_game(pgn_stream)

            if game is None:
                break

            board = game.board()
            moves = []

            for move in game.mainline_moves():
                moves.append(move.uci())
                board.push(move)

            if moves:
                games.append(moves)

        return games

    def decrypt_from_games(self, games):
        """Расшифровывает список партий обратно в текст."""

        bits = ""
        expected_total_bits = None

        for game in games:
            board = chess.Board()

            for move_text in game:
                move = chess.Move.from_uci(move_text)

                usable_moves, k = self.oracle.get_usable_moves(board)

                if len(usable_moves) == 0:
                    raise ValueError(
                        "В этой позиции уже нельзя было кодировать данные. "
                        "Возможно, файл повреждён."
                    )

                if move not in usable_moves:
                    raise ValueError(
                        "Неверный ключ или повреждённый файл. "
                        "Ход не найден в секретном списке: " + move_text
                    )

                move_index = usable_moves.index(move)
                chunk = format(move_index, f"0{k}b")
                bits += chunk

                # Когда набрали первые 32 бита, узнаём длину сообщения
                if expected_total_bits is None and len(bits) >= 32:
                    message_length = int(bits[:32], 2)
                    expected_total_bits = 32 + message_length * 8

                board.push(move)

                # Если все нужные биты уже получены, заканчиваем
                if expected_total_bits is not None and len(bits) >= expected_total_bits:
                    return BitConverter.bits_to_text(bits[:expected_total_bits])

        raise ValueError("Файл закончился раньше, чем сообщение было восстановлено")

    def decrypt_from_cpgn_file(self, input_path):
        """Главная функция расшифровки из файла .cpgn."""

        if not os.path.exists(input_path):
            raise FileNotFoundError("Файл не найден: " + input_path)

        if not input_path.endswith(".cpgn"):
            raise ValueError("Файл должен иметь расширение .cpgn")

        with open(input_path, "r", encoding="utf-8") as file:
            pgn_text = file.read()

        games = self.pgn_to_games(pgn_text)

        if not games:
            raise ValueError("В файле не найдено шахматных партий")

        return self.decrypt_from_games(games)


# ============================================================
# 5. Единый интерфейс
# ============================================================


class ChessCipher:
    """Единый интерфейс для шифрования и расшифровки."""

    def __init__(self, key):
        self.key = key
        self.encoder = ChessCipherEncoder(key)
        self.decoder = ChessCipherDecoder(key)

    def encrypt(self, message, output_path=None):
        if output_path:
            return self.encoder.encrypt_to_cpgn_file(message, output_path)
        return self.encoder.encrypt_to_games(message)

    def decrypt_file(self, input_path):
        return self.decoder.decrypt_from_cpgn_file(input_path)

    def decrypt_pgn(self, pgn_text):
        games = self.decoder.pgn_to_games(pgn_text)
        return self.decoder.decrypt_from_games(games)


# ============================================================
# 6. Меню программы
# ============================================================


def show_menu():
    print()
    print("====================================")
    print("        CHESS MOVE CIPHER")
    print("====================================")
    print("1. Зашифровать данные")
    print("2. Расшифровать данные")
    print("3. Выход")
    print("====================================")


def encrypt_menu():
    print()
    print("=== ШИФРОВАНИЕ ===")

    message = input("Введите сообщение для шифрования: ")
    key = input("Введите секретный ключ: ")
    output_path = input("Введите имя файла для сохранения (.cpgn): ")

    if output_path.strip() == "":
        output_path = "encrypted_message.cpgn"

    output_path = output_path.strip()

    try:
        encoder = ChessCipherEncoder(key)
        saved_path = encoder.encrypt_to_cpgn_file(message, output_path)

        print()
        print("Готово.")
        print("Сообщение зашифровано в файл:")
        print(saved_path)

    except Exception as error:
        print()
        print("Ошибка при шифровании:")
        print(error)


def decrypt_menu():
    print()
    print("=== РАСШИФРОВКА ===")

    input_path = input("Введите путь к .cpgn файлу: ")
    key = input("Введите секретный ключ: ")

    input_path = input_path.strip()

    try:
        decoder = ChessCipherDecoder(key)
        message = decoder.decrypt_from_cpgn_file(input_path)

        print()
        print("Расшифрованное сообщение:")
        print(message)

    except Exception as error:
        print()
        print("Ошибка при расшифровке:")
        print(error)


def main():
    while True:
        show_menu()

        choice = input("Выберите действие: ").strip()

        if choice == "1":
            encrypt_menu()

        elif choice == "2":
            decrypt_menu()

        elif choice == "3":
            print("Выход из программы.")
            break

        else:
            print("Неверный выбор. Введите 1, 2 или 3.")


if __name__ == "__main__":
    main()
