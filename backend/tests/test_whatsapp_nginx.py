"""Optional real Nginx proxy test; never contacts Meta or the live website."""
import hashlib
import hmac
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from unittest.mock import patch

from flask import Flask
import mongomock
import pytest
import requests
from werkzeug.serving import make_server

from app.whatsapp_routes import webhook_bp


@pytest.mark.skipif(shutil.which("nginx") is None, reason="Nginx executable unavailable; real proxy validation remains a VPS/CI dependency")
def test_real_nginx_preserves_challenge_raw_body_and_signature(tmp_path):
    root = Path(__file__).resolve().parents[2]
    app = Flask("isolated-nginx-webhook")
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False, WHATSAPP_APP_SECRET="synthetic-nginx-secret",
                      WHATSAPP_WEBHOOK_VERIFY_TOKEN="synthetic-nginx-verify", WHATSAPP_BUSINESS_ACCOUNT_ID="67890", WHATSAPP_PHONE_NUMBER_ID="12345")
    app.register_blueprint(webhook_bp, url_prefix="/api/webhooks")
    server = make_server("127.0.0.1", 0, app)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    snippet = (root / "deploy/nginx/whatsapp-location.conf").read_text().replace("127.0.0.1:5000", "127.0.0.1:" + str(server.server_port))
    config = tmp_path / "nginx.conf"
    config.write_text("pid " + (tmp_path / "nginx.pid").as_posix() + ";\nerror_log stderr warn;\nevents {}\nhttp { access_log off; server { listen 127.0.0.1:" + str(port) + ";\n" + snippet + '\nlocation = /website-test { return 200 "website unchanged"; }\n} }\n')
    command = [shutil.which("nginx"), "-p", tmp_path.as_posix() + "/", "-c", config.as_posix()]
    subprocess.run(command + ["-t"], check=True, capture_output=True)
    process = subprocess.Popen(command + ["-g", "daemon off;"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    db = mongomock.MongoClient().proxy_test
    try:
        base = "http://127.0.0.1:" + str(port)
        for _ in range(100):
            try:
                if requests.get(base + "/website-test", timeout=1).status_code == 200:
                    break
            except requests.RequestException:
                time.sleep(.05)
        with patch("app.whatsapp_routes.database", return_value=db):
            url = base + "/api/webhooks/whatsapp"
            response = requests.get(url, params={"hub.mode": "subscribe", "hub.verify_token": "synthetic-nginx-verify", "hub.challenge": "challenge"}, timeout=3)
            assert response.status_code == 200 and response.text == "challenge"
            assert requests.get(url, timeout=3).status_code == 403
            raw = b'{ "object": "whatsapp_business_account", "entry": [] }'
            signature = "sha256=" + hmac.new(b"synthetic-nginx-secret", raw, hashlib.sha256).hexdigest()
            assert requests.post(url, data=raw, headers={"X-Hub-Signature-256": signature}, timeout=3).status_code == 200
            assert requests.post(url, data=raw + b" ", headers={"X-Hub-Signature-256": signature}, timeout=3).status_code == 403
            assert requests.post(url, data=raw, timeout=3).status_code == 403
            assert requests.get(base + "/website-test", timeout=3).text == "website unchanged"
    finally:
        process.terminate(); process.wait(timeout=5)
        server.shutdown(); thread.join(timeout=5)
