import json
import os
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app


class FitnessServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original_master_username = os.environ.get("ROCHA_FITNESS_MASTER_USERNAME")
        cls.original_master_password = os.environ.get("ROCHA_FITNESS_MASTER_PASSWORD")
        cls.original_database_path = app.DATABASE_PATH
        os.environ["ROCHA_FITNESS_MASTER_USERNAME"] = "test-master"
        os.environ["ROCHA_FITNESS_MASTER_PASSWORD"] = "test-master-password"
        cls.temp_dir = tempfile.TemporaryDirectory()
        app.DATABASE_PATH = Path(cls.temp_dir.name) / "test.db"
        app.initialize_database()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.FitnessRequestHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"
        request = Request(
            f"{cls.base_url}/api/login",
            data=json.dumps(
                {"username": "test-master", "password": "test-master-password"}
            ).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request) as response:
            cookie = SimpleCookie(response.headers["Set-Cookie"])
            cls.auth_cookie = cookie["rf_session"].OutputString()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp_dir.cleanup()
        app.DATABASE_PATH = cls.original_database_path
        if cls.original_master_username is None:
            os.environ.pop("ROCHA_FITNESS_MASTER_USERNAME", None)
        else:
            os.environ["ROCHA_FITNESS_MASTER_USERNAME"] = cls.original_master_username
        if cls.original_master_password is None:
            os.environ.pop("ROCHA_FITNESS_MASTER_PASSWORD", None)
        else:
            os.environ["ROCHA_FITNESS_MASTER_PASSWORD"] = cls.original_master_password

    def setUp(self):
        with app.database_connection() as connection:
            connection.execute(
                "DELETE FROM app_settings WHERE key = 'license_expires_at'"
            )

    def request_json(self, path, method="GET", body=None, authenticated=True):
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if authenticated:
            headers["Cookie"] = self.auth_cookie
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers=headers,
        )
        with urlopen(request) as response:
            return response.status, json.loads(response.read())

    def test_static_site_is_served(self):
        with urlopen(f"{self.base_url}/") as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b"Conhe\xc3\xa7a", response.read())
        with urlopen(f"{self.base_url}/admin") as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b"Painel", response.read())

    def test_records_api_requires_login(self):
        with self.assertRaises(HTTPError) as error:
            self.request_json("/api/records", authenticated=False)
        self.assertEqual(error.exception.code, 401)
        with error.exception:
            self.assertEqual(
                json.loads(error.exception.read())["error"],
                "Faça login para continuar.",
            )

    def test_master_remains_available_after_database_file_is_removed(self):
        app.DATABASE_PATH.unlink()
        status, settings = self.request_json("/api/master/settings")
        self.assertEqual(status, 200)
        self.assertIsNone(settings["license_expires_at"])
        self.assertTrue(app.DATABASE_PATH.is_file())

    def test_record_create_update_delete_and_persist(self):
        status, created = self.request_json(
            "/api/records/clientes",
            "POST",
            {"nome": "Aluno de teste", "telefone": "(12) 99999-0000", "plano": "Mensal"},
        )
        self.assertEqual(status, 201)
        record_id = created["record"]["id"]

        _, records = self.request_json("/api/records/clientes")
        self.assertEqual(records[0]["nome"], "Aluno de teste")

        self.request_json(
            f"/api/records/clientes/{record_id}",
            "PUT",
            {"nome": "Aluno atualizado", "telefone": "(12) 99999-0000", "plano": "Mensal"},
        )
        app.initialize_database()
        _, records = self.request_json("/api/records/clientes")
        self.assertEqual(records[0]["nome"], "Aluno atualizado")

        self.request_json(f"/api/records/clientes/{record_id}", "DELETE")
        _, records = self.request_json("/api/records/clientes")
        self.assertEqual(records, [])

    def test_invalid_records_are_rejected(self):
        with self.assertRaises(HTTPError) as error:
            self.request_json("/api/records/clientes", "POST", {"nome": "Sem telefone"})
        self.assertEqual(error.exception.code, 400)
        with error.exception:
            self.assertEqual(json.loads(error.exception.read())["error"], "Preencha todos os campos obrigatórios.")

    def test_partnership_image_is_publicly_available(self):
        image = "data:image/png;base64,aGVsbG8="
        self.request_json(
            "/api/records/parcerias",
            "POST",
            {"nome": "Parceiro de teste", "descricao": "Apoio local", "imagem": image},
        )
        _, partners = self.request_json("/api/public/parcerias")
        partner = next(item for item in partners if item["nome"] == "Parceiro de teste")
        self.assertEqual(partner["imagem"], image)
        self.assertNotIn("id", partner)

    def test_partnership_rejects_non_image_upload(self):
        with self.assertRaises(HTTPError) as error:
            self.request_json(
                "/api/records/parcerias",
                "POST",
                {"nome": "Parceiro inválido", "imagem": "data:text/html;base64,YQ=="},
            )
        self.assertEqual(error.exception.code, 400)
        with error.exception:
            self.assertIn("Selecione uma imagem", json.loads(error.exception.read())["error"])

    def test_master_can_create_admin_with_hashed_password(self):
        password = "another-secure-password"
        status, created = self.request_json(
            "/api/master/users",
            "POST",
            {"username": "frontdesk", "password": password},
        )
        self.assertEqual(status, 201)
        self.assertEqual(created["username"], "frontdesk")
        with app.database_connection() as connection:
            row = connection.execute(
                "SELECT password_hash FROM admin_users WHERE username = ?",
                ("frontdesk",),
            ).fetchone()
        self.assertNotIn(password, row["password_hash"])

        request = Request(
            f"{self.base_url}/api/login",
            data=json.dumps({"username": "frontdesk", "password": password}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)

    def test_expired_license_blocks_admin_data_but_not_public_site_or_master(self):
        self.request_json(
            "/api/master/settings",
            "PUT",
            {"license_expires_at": "2000-01-01"},
        )
        with self.assertRaises(HTTPError) as error:
            self.request_json("/api/records")
        self.assertEqual(error.exception.code, 403)
        with error.exception:
            self.assertTrue(json.loads(error.exception.read())["license_expired"])

        status, settings = self.request_json("/api/master/settings")
        self.assertEqual(status, 200)
        self.assertTrue(settings["license_expired"])
        status, _ = self.request_json("/api/public/parcerias", authenticated=False)
        self.assertEqual(status, 200)


if __name__ == "__main__":
    unittest.main()
