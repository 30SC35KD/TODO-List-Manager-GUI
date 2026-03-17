import hashlib
import json
import os
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data" / "web_store"
ACCOUNTS_FILE = DATA_DIR / "accounts.json"


def now_text() -> str:
    return datetime.now().replace(second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ensure_storage() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ACCOUNTS_FILE.exists():
        ACCOUNTS_FILE.write_text(json.dumps({"users": {}}, ensure_ascii=False, indent=2), encoding="utf-8")


def load_accounts() -> dict:
    ensure_storage()
    return json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))


def save_accounts(payload: dict) -> None:
    ensure_storage()
    ACCOUNTS_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def tasks_file(username: str) -> Path:
    digest = sha256(username)[:20]
    return DATA_DIR / f"tasks_{digest}.json"


def load_tasks(username: str) -> list[dict]:
    file_path = tasks_file(username)
    if not file_path.exists():
        return []
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
        tasks = payload.get("tasks", [])
        return tasks if isinstance(tasks, list) else []
    except Exception:
        return []


def save_tasks(username: str, tasks: list[dict]) -> None:
    file_path = tasks_file(username)
    payload = {"tasks": tasks, "updated_at": now_text()}
    file_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json_body(handler: SimpleHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length) if length > 0 else b"{}"
    try:
        body = json.loads(raw.decode("utf-8"))
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send_json(self, code: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _ok(self, payload: dict) -> None:
        self._send_json(HTTPStatus.OK, payload)

    def _bad(self, message: str) -> None:
        self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "msg": message})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._ok({"ok": True, "msg": "alive", "time": now_text()})
            return

        if parsed.path == "/api/tasks/load":
            query = parse_qs(parsed.query)
            username = (query.get("username") or [""])[0].strip()
            if not username:
                self._bad("缺少用户名")
                return
            self._ok({"ok": True, "tasks": load_tasks(username)})
            return

        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        body = read_json_body(self)

        if parsed.path == "/api/register":
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", "")).strip()
            if not username or not password:
                self._bad("用户名和密码不能为空")
                return
            accounts = load_accounts()
            users = accounts.get("users", {})
            if username in users:
                self._bad("用户名已存在")
                return
            users[username] = {
                "password_hash": sha256(password),
                "created_at": now_text(),
            }
            accounts["users"] = users
            save_accounts(accounts)
            save_tasks(username, [])
            self._ok({"ok": True, "msg": "注册成功"})
            return

        if parsed.path == "/api/login":
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", "")).strip()
            if not username or not password:
                self._bad("用户名和密码不能为空")
                return
            accounts = load_accounts()
            user = accounts.get("users", {}).get(username)
            if not user:
                self._bad("账户不存在")
                return
            if user.get("password_hash") != sha256(password):
                self._bad("密码错误")
                return
            self._ok({"ok": True, "msg": "登录成功", "tasks": load_tasks(username)})
            return

        if parsed.path == "/api/tasks/save":
            username = str(body.get("username", "")).strip()
            tasks = body.get("tasks", [])
            if not username:
                self._bad("缺少用户名")
                return
            if not isinstance(tasks, list):
                self._bad("任务数据格式错误")
                return
            save_tasks(username, tasks)
            self._ok({"ok": True, "msg": "保存成功"})
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "msg": "接口不存在"})


def run() -> None:
    ensure_storage()
    port = int(os.environ.get("FLOWDO_PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AppHandler)
    print(f"FlowDo running at http://127.0.0.1:{port}")
    print(f"Data directory: {DATA_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
