import base64
import getpass
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import date
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from http.cookies import CookieError, SimpleCookie
from urllib.parse import unquote, urlsplit


PROJECT_ROOT = Path(__file__).resolve().parent
DATABASE_PATH = Path(
    os.environ.get("ROCHA_FITNESS_DATABASE", PROJECT_ROOT / "rocha_fitness.db")
).resolve()
SESSION_SECRET = secrets.token_bytes(32)
SESSION_DURATION_SECONDS = 8 * 60 * 60
PASSWORD_HASH_ITERATIONS = 310_000
MASTER_USERNAME_SETTING = "master_username"
MASTER_PASSWORD_HASH_SETTING = "master_password_hash"
USERNAME_PATTERN = r"[A-Za-z0-9._-]{3,32}"
COLLECTION_FIELDS = {
    "usuarios": ({"nome", "email", "perfil", "telefone"}, {"nome", "email"}),
    "clientes": (
        {"nome", "telefone", "email", "nascimento", "plano", "vencimento", "status"},
        {"nome", "telefone"},
    ),
    "funcionarios": (
        {"nome", "cargo", "telefone", "email", "admissao"},
        {"nome", "cargo"},
    ),
    "financas": (
        {"descricao", "tipo", "categoria", "valor", "data", "status"},
        {"descricao", "valor", "data"},
    ),
    "parcerias": ({"nome", "descricao", "imagem"}, {"nome", "imagem"}),
}
DEFAULT_PARTNERS = (
    "Escola Nacional Florestan Fernandes",
    "Graal",
    "Autopoli",
    "ParaDouro Batistela",
    "Organização Campo das Oliveiras",
    "Kautex",
)
COLLECTION_OPTIONS = {
    ("usuarios", "perfil"): {"Administrador", "Recepção", "Financeiro"},
    ("clientes", "plano"): {"Semestral", "Trimestral", "Mensal", "Casal"},
    ("clientes", "status"): {"Ativo", "Inativo"},
    ("financas", "tipo"): {"Receita", "Despesa"},
    ("financas", "categoria"): {
        "Mensalidade",
        "Matrícula",
        "Folha de pagamento",
        "Aluguel",
        "Equipamentos",
        "Outros",
    },
    ("financas", "status"): {"Pago", "Pendente"},
}
PUBLIC_FILES = {
    "index.html",
    "styles.css",
    "app.js",
    "admin.html",
    "public.css",
    "public.js",
}


def connect_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS records (
            collection TEXT NOT NULL,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (collection, id)
        );
        CREATE TABLE IF NOT EXISTS admin_users (
            username TEXT PRIMARY KEY COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        """
    )
    return connection


@contextmanager
def database_connection():
    connection = connect_database()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database():
    with database_connection() as connection:
        has_partners = connection.execute(
            "SELECT 1 FROM records WHERE collection = 'parcerias' LIMIT 1"
        ).fetchone()
        if not has_partners:
            connection.executemany(
                "INSERT INTO records (collection, id, data) VALUES (?, ?, ?)",
                (
                    (
                        "parcerias",
                        str(uuid.uuid4()),
                        json.dumps(
                            {"nome": name, "descricao": "", "imagem": ""},
                            ensure_ascii=False,
                        ),
                    )
                    for name in DEFAULT_PARTNERS
                ),
            )


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS
    )
    return f"{salt.hex()}:{password_hash.hex()}"


def verify_password(password, encoded_hash):
    try:
        salt_hex, expected_hash = encoded_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
    except (ValueError, AttributeError):
        return False
    actual_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS
    ).hex()
    return hmac.compare_digest(actual_hash, expected_hash)


def get_master_credentials():
    with database_connection() as connection:
        rows = connection.execute(
            "SELECT key, value FROM app_settings WHERE key IN (?, ?)",
            (MASTER_USERNAME_SETTING, MASTER_PASSWORD_HASH_SETTING),
        ).fetchall()
    settings = {row["key"]: row["value"] for row in rows}
    username = settings.get(MASTER_USERNAME_SETTING)
    password_hash = settings.get(MASTER_PASSWORD_HASH_SETTING)
    if not username or not password_hash:
        return None
    return username, password_hash


def set_master_credentials(username, password):
    if not isinstance(username, str) or not re.fullmatch(USERNAME_PATTERN, username):
        raise ValueError(
            "O usuário master deve ter de 3 a 32 caracteres: letras, números, "
            "ponto, hífen ou sublinhado."
        )
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError("A senha master deve ter de 12 a 1024 caracteres.")
    password_hash = hash_password(password)
    with database_connection() as connection:
        connection.executemany(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (
                (MASTER_USERNAME_SETTING, username),
                (MASTER_PASSWORD_HASH_SETTING, password_hash),
            ),
        )


def configure_master_user():
    if get_master_credentials():
        return

    legacy_username = os.environ.get("ROCHA_FITNESS_MASTER_USERNAME", "").strip()
    legacy_password = os.environ.get("ROCHA_FITNESS_MASTER_PASSWORD", "")
    if legacy_username or legacy_password:
        if not legacy_username or not legacy_password:
            raise RuntimeError(
                "As variáveis antigas da conta master estão incompletas. "
                "Configure ambas ou remova-as para cadastrar uma conta master."
            )
        set_master_credentials(legacy_username, legacy_password)
        print("Conta master migrada para o banco de dados.")
        return

    print("Configure a conta master inicial. A senha não será exibida.")
    username = input("Usuário master: ").strip()
    password = getpass.getpass("Senha master (mínimo 12 caracteres): ")
    confirmation = getpass.getpass("Confirme a senha master: ")
    if password != confirmation:
        raise RuntimeError("As senhas não conferem; a conta master não foi criada.")
    set_master_credentials(username, password)


def current_license_expiry():
    with database_connection() as connection:
        row = connection.execute(
            "SELECT value FROM app_settings WHERE key = 'license_expires_at'"
        ).fetchone()
    return row["value"] if row else None


def license_is_expired(expiry):
    return bool(expiry and expiry < date.today().isoformat())


def validate_record(collection, data):
    if not isinstance(data, dict):
        raise ValueError("O corpo da requisição deve ser um objeto JSON.")

    fields, required = COLLECTION_FIELDS[collection]
    unknown_fields = set(data) - fields
    if unknown_fields:
        raise ValueError("O cadastro contém campos não reconhecidos.")

    for field in required:
        if field not in data or data[field] is None or not str(data[field]).strip():
            raise ValueError("Preencha todos os campos obrigatórios.")

    if any(not isinstance(value, (str, int, float)) for value in data.values()):
        raise ValueError("Os dados do cadastro devem ser valores simples.")

    for field, options in COLLECTION_OPTIONS.items():
        if field[0] == collection and field[1] in data and data[field[1]]:
            if data[field[1]] not in options:
                raise ValueError("Uma das opções selecionadas é inválida.")

    if collection == "financas":
        try:
            amount = float(data["valor"])
        except (TypeError, ValueError) as error:
            raise ValueError("Informe um valor financeiro válido.") from error
        if amount <= 0:
            raise ValueError("O valor financeiro deve ser maior que zero.")
        data = {**data, "valor": f"{amount:.2f}"}

    if collection == "parcerias":
        image = data["imagem"]
        match = re.fullmatch(
            r"data:(image/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})",
            image,
        )
        if not match:
            raise ValueError("Selecione uma imagem JPEG, PNG, WebP ou GIF.")
        try:
            image_bytes = base64.b64decode(match.group(2), validate=True)
        except ValueError as error:
            raise ValueError("A imagem selecionada não é válida.") from error
        if not image_bytes or len(image_bytes) > 700 * 1024:
            raise ValueError("A imagem deve ter no máximo 700 KB.")

    return data


def decode_record(row):
    record = json.loads(row["data"])
    record["id"] = row["id"]
    return record


class FitnessRequestHandler(BaseHTTPRequestHandler):
    server_version = "RochaFitness/1.0"

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Tamanho da requisição inválido.") from error
        if content_length <= 0 or content_length > 1_048_576:
            raise ValueError("O corpo deve ter entre 1 byte e 1 MB.")
        try:
            return json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("O corpo da requisição não contém JSON válido.") from error

    def request_parts(self):
        path = unquote(urlsplit(self.path).path)
        parts = path.strip("/").split("/")
        if parts and parts[0] == "api":
            return parts
        return None

    def set_session_cookie(self, username, is_master):
        payload = json.dumps(
            {
                "username": username,
                "master": is_master,
                "expires": int(time.time()) + SESSION_DURATION_SECONDS,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        encoded_payload = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
        signature = hmac.new(
            SESSION_SECRET, encoded_payload.encode("ascii"), hashlib.sha256
        ).hexdigest()
        self.send_header(
            "Set-Cookie",
            f"rf_session={encoded_payload}.{signature}; Path=/; HttpOnly; "
            f"SameSite=Strict; Max-Age={SESSION_DURATION_SECONDS}",
        )

    def get_session(self):
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        cookie = cookies.get("rf_session")
        if not cookie:
            return None
        try:
            encoded_payload, signature = cookie.value.rsplit(".", 1)
            expected_signature = hmac.new(
                SESSION_SECRET, encoded_payload.encode("ascii"), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected_signature):
                return None
            padded_payload = encoded_payload + "=" * (-len(encoded_payload) % 4)
            session = json.loads(
                base64.urlsafe_b64decode(padded_payload).decode("utf-8")
            )
            if not isinstance(session, dict) or session["expires"] <= int(time.time()):
                return None
            if session.get("master") is True:
                configured_credentials = get_master_credentials()
                if (
                    not configured_credentials
                    or session.get("username", "").casefold()
                    != configured_credentials[0].casefold()
                ):
                    return None
                return session
            with database_connection() as connection:
                user = connection.execute(
                    "SELECT 1 FROM admin_users WHERE username = ?",
                    (session.get("username"),),
                ).fetchone()
            return session if user else None
        except (ValueError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
            return None

    def require_session(self, master_only=False, records_access=False):
        session = self.get_session()
        if not session:
            self.send_json(
                HTTPStatus.UNAUTHORIZED, {"error": "Faça login para continuar."}
            )
            return None
        is_master = session.get("master") is True
        if master_only and not is_master:
            self.send_json(
                HTTPStatus.FORBIDDEN,
                {"error": "Somente o usuário master pode realizar esta operação."},
            )
            return None
        if records_access:
            expiry = current_license_expiry()
            if license_is_expired(expiry):
                self.send_json(
                    HTTPStatus.FORBIDDEN,
                    {
                        "error": "A disponibilidade do painel expirou. "
                        "Procure o usuário master.",
                        "license_expired": True,
                    },
                )
                return None
        return session

    def login(self):
        try:
            data = self.read_json()
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if not isinstance(data, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Informe usuário e senha."})
            return
        username = data.get("username")
        password = data.get("password")
        if (
            not isinstance(username, str)
            or not isinstance(password, str)
            or len(password) > 1024
        ):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Informe usuário e senha."})
            return

        configured_credentials = get_master_credentials()
        master_username = None
        is_master = False
        if configured_credentials:
            master_username, master_password_hash = configured_credentials
            if username.casefold() == master_username.casefold():
                is_master = verify_password(password, master_password_hash)
        user = None
        if not is_master and (
            master_username is None
            or username.casefold() != master_username.casefold()
        ):
            with database_connection() as connection:
                user = connection.execute(
                    "SELECT password_hash FROM admin_users WHERE username = ?",
                    (username,),
                ).fetchone()
        if not is_master and (not user or not verify_password(password, user["password_hash"])):
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Usuário ou senha inválidos."})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.set_session_cookie(master_username if is_master else username, is_master)
        self.end_headers()
        self.wfile.write(
            json.dumps(
                {"authenticated": True, "username": master_username if is_master else username},
                ensure_ascii=False,
            ).encode("utf-8")
        )

    def do_GET(self):
        parts = self.request_parts()
        if parts:
            if parts == ["api", "health"]:
                self.send_json(HTTPStatus.OK, {"status": "ok"})
            elif parts == ["api", "public", "parcerias"]:
                self.get_public_partners()
            elif parts == ["api", "session"]:
                self.get_session_status()
            elif parts == ["api", "master", "settings"]:
                self.get_master_settings()
            elif parts == ["api", "master", "users"]:
                self.get_master_users()
            elif parts == ["api", "records"]:
                if self.require_session(records_access=True):
                    self.get_all_records()
            elif len(parts) == 3 and parts[1] == "records":
                if self.require_session(records_access=True):
                    self.get_records(parts[2])
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Rota da API não encontrada."})
            return
        self.serve_static_file()

    def get_session_status(self):
        session = self.get_session()
        expiry = current_license_expiry()
        self.send_json(
            HTTPStatus.OK,
            {
                "authenticated": bool(session),
                "username": session.get("username") if session else None,
                "is_master": session.get("master", False) if session else False,
                "license_expires_at": expiry,
                "license_expired": license_is_expired(expiry),
            },
        )

    def get_master_settings(self):
        if not self.require_session(master_only=True):
            return
        self.send_json(
            HTTPStatus.OK,
            {
                "license_expires_at": current_license_expiry(),
                "license_expired": license_is_expired(current_license_expiry()),
            },
        )

    def get_master_users(self):
        if not self.require_session(master_only=True):
            return
        with database_connection() as connection:
            users = connection.execute(
                "SELECT username, created_at FROM admin_users ORDER BY username"
            ).fetchall()
        self.send_json(
            HTTPStatus.OK,
            {"users": [dict(user) for user in users]},
        )

    def get_all_records(self):
        result = {collection: [] for collection in COLLECTION_FIELDS}
        with database_connection() as connection:
            rows = connection.execute(
                "SELECT collection, id, data FROM records ORDER BY rowid DESC"
            ).fetchall()
        for row in rows:
            result[row["collection"]].append(decode_record(row))
        self.send_json(HTTPStatus.OK, result)

    def get_records(self, collection):
        if collection not in COLLECTION_FIELDS:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Cadastro não encontrado."})
            return
        with database_connection() as connection:
            rows = connection.execute(
                "SELECT id, data FROM records WHERE collection = ? ORDER BY rowid DESC",
                (collection,),
            ).fetchall()
        self.send_json(HTTPStatus.OK, [decode_record(row) for row in rows])

    def get_public_partners(self):
        with database_connection() as connection:
            rows = connection.execute(
                "SELECT id, data FROM records WHERE collection = 'parcerias' "
                "ORDER BY rowid DESC"
            ).fetchall()
        self.send_json(
            HTTPStatus.OK,
            [
                {
                    key: record[key]
                    for key in ("nome", "descricao", "imagem")
                    if key in record
                }
                for record in (decode_record(row) for row in rows)
            ],
        )

    def do_POST(self):
        parts = self.request_parts()
        if parts == ["api", "login"]:
            self.login()
            return
        if parts == ["api", "logout"]:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header(
                "Set-Cookie",
                "rf_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
            )
            self.end_headers()
            self.wfile.write(b'{"authenticated":false}')
            return
        if parts == ["api", "master", "users"]:
            self.create_master_user()
            return
        if not parts or len(parts) != 3 or parts[1] != "records":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Rota da API não encontrada."})
            return
        if not self.require_session(records_access=True):
            return
        collection = parts[2]
        if collection not in COLLECTION_FIELDS:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Cadastro não encontrado."})
            return
        try:
            data = validate_record(collection, self.read_json())
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        record_id = str(uuid.uuid4())
        with database_connection() as connection:
            connection.execute(
                "INSERT INTO records (collection, id, data) VALUES (?, ?, ?)",
                (collection, record_id, json.dumps(data, ensure_ascii=False)),
            )
        self.send_json(HTTPStatus.CREATED, {"record": {**data, "id": record_id}})

    def create_master_user(self):
        if not self.require_session(master_only=True):
            return
        try:
            data = self.read_json()
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if not isinstance(data, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Informe usuário e senha."})
            return
        username = data.get("username")
        password = data.get("password")
        if not isinstance(username, str) or not re.fullmatch(USERNAME_PATTERN, username):
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "O usuário deve ter de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado."},
            )
            return
        if not isinstance(password, str) or not 12 <= len(password) <= 1024:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "A senha do novo administrador deve ter pelo menos 12 caracteres."},
            )
            return
        configured_credentials = get_master_credentials()
        if (
            configured_credentials
            and username.casefold() == configured_credentials[0].casefold()
        ):
            self.send_json(
                HTTPStatus.CONFLICT,
                {"error": "Este nome de usuário é reservado para o master."},
            )
            return
        try:
            with database_connection() as connection:
                connection.execute(
                    "INSERT INTO admin_users (username, password_hash, created_at) "
                    "VALUES (?, ?, ?)",
                    (username, hash_password(password), date.today().isoformat()),
                )
        except sqlite3.IntegrityError:
            self.send_json(
                HTTPStatus.CONFLICT, {"error": "Este usuário já está cadastrado."}
            )
            return
        self.send_json(HTTPStatus.CREATED, {"username": username})

    def do_PUT(self):
        parts = self.request_parts()
        if parts == ["api", "master", "settings"]:
            self.update_master_settings()
            return
        if not parts or len(parts) != 4 or parts[1] != "records":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Rota da API não encontrada."})
            return
        if not self.require_session(records_access=True):
            return
        collection, record_id = parts[2], parts[3]
        if collection not in COLLECTION_FIELDS:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Cadastro não encontrado."})
            return
        try:
            data = validate_record(collection, self.read_json())
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return

        with database_connection() as connection:
            result = connection.execute(
                "UPDATE records SET data = ? WHERE collection = ? AND id = ?",
                (json.dumps(data, ensure_ascii=False), collection, record_id),
            )
        if result.rowcount == 0:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Registro não encontrado."})
            return
        self.send_json(HTTPStatus.OK, {"record": {**data, "id": record_id}})

    def update_master_settings(self):
        if not self.require_session(master_only=True):
            return
        try:
            data = self.read_json()
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        if not isinstance(data, dict):
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Informe a data final de disponibilidade."},
            )
            return
        expiry = data.get("license_expires_at")
        if expiry in ("", None):
            expiry = None
        elif not isinstance(expiry, str):
            expiry = False
        else:
            try:
                expiry = date.fromisoformat(expiry).isoformat()
            except ValueError:
                expiry = False
        if expiry is False:
            self.send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Informe uma data válida no formato AAAA-MM-DD."},
            )
            return
        with database_connection() as connection:
            connection.execute(
                "INSERT INTO app_settings (key, value) VALUES ('license_expires_at', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (expiry,),
            )
        self.send_json(
            HTTPStatus.OK,
            {
                "license_expires_at": expiry,
                "license_expired": license_is_expired(expiry),
            },
        )

    def do_DELETE(self):
        parts = self.request_parts()
        if not parts or len(parts) != 4 or parts[1] != "records":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Rota da API não encontrada."})
            return
        if not self.require_session(records_access=True):
            return
        collection, record_id = parts[2], parts[3]
        if collection not in COLLECTION_FIELDS:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Cadastro não encontrado."})
            return
        with database_connection() as connection:
            result = connection.execute(
                "DELETE FROM records WHERE collection = ? AND id = ?",
                (collection, record_id),
            )
        if result.rowcount == 0:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Registro não encontrado."})
            return
        self.send_json(HTTPStatus.OK, {"deleted": True})

    def serve_static_file(self):
        requested_path = urlsplit(self.path).path
        if requested_path in {"/", "/admin", "/admin/"}:
            relative_path = "index.html" if requested_path == "/" else "admin.html"
        else:
            relative_path = unquote(requested_path).lstrip("/")
        path_parts = Path(relative_path).parts
        is_public_asset = len(path_parts) == 2 and path_parts[0] == "assets"
        if relative_path not in PUBLIC_FILES and not is_public_asset:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        file_path = (PROJECT_ROOT / relative_path).resolve()
        if not file_path.is_relative_to(PROJECT_ROOT) or not file_path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = file_path.read_bytes()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") or content_type == "application/javascript" else content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    initialize_database()
    configure_master_user()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), FitnessRequestHandler)
    print("Rocha Fitness disponível em http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
