"""Dedicated RK-WEB catalog.sync.v1 outbox worker."""
import logging
import os
import signal
import time
from uuid import uuid4

import requests

from app import create_app
from app.catalog_sync_v1 import ACK_STATUSES, claim_due, complete, fail
from app.rbac import database

running = True
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rk-web.catalog-worker")


def stop(*_args):
    global running
    running = False


def main():
    signal.signal(signal.SIGINT, stop); signal.signal(signal.SIGTERM, stop)
    app = create_app(); worker_id = f"rk-web-{uuid4()}"
    with app.app_context():
        while running:
            event = claim_due(database(), worker_id)
            if not event: time.sleep(2); continue
            try:
                url = str(app.config.get("STOCK_CATALOG_SYNC_URL") or "").rstrip("/")
                secret = str(app.config.get("STOCK_INTEGRATION_BOOTSTRAP_SECRET") or "")
                if not url or not secret: raise RuntimeError("RK-STOCK catalog receiver is not configured")
                response = requests.post(f"{url}/api/integrations/internal/catalog/events", json={key: value for key, value in event.items() if key not in {"_id", "status", "attempts", "next_attempt_at", "created_at", "updated_at", "lease_id", "lease_until", "claimed_at", "last_error"}}, headers={"Authorization": f"Bearer {secret}"}, timeout=10)
                data = response.json() if response.content else {}
                if response.status_code in {429, 500, 502, 503, 504}: raise RuntimeError("RK-STOCK catalog receiver temporarily unavailable")
                if data.get("status") == "CONFLICT" and response.status_code == 409:
                    complete(database(), event, "CONFLICT"); continue
                if not response.ok or data.get("status") not in ACK_STATUSES: raise RuntimeError(f"RK-STOCK rejected catalog event ({response.status_code})")
                complete(database(), event, data["status"])
            except Exception as error:
                fail(database(), event, error); logger.warning("catalog delivery failed event_id=%s", event.get("event_id"))


if __name__ == "__main__": main()
