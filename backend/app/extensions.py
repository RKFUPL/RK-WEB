from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask import current_app, g, request
from flask_mail import Mail
from flask_pymongo import PyMongo
import hashlib
import hmac
import ipaddress

cors = CORS()
jwt = JWTManager()
mail = Mail()
mongo = PyMongo()


def resolved_client_address(_config, peer, _forwarded=None):
    """Use the direct TCP peer until a server-side header overwrite is proven.

    Next.js external rewrites forward incoming request headers. Therefore a
    custom header from the browser is not authenticated merely because Flask's
    peer is the Next container. X-Forwarded-For, CF-Connecting-IP and
    X-RK-Verified-Client-IP are intentionally ignored here.
    """
    try:
        peer_address = ipaddress.ip_address(str(peer or ""))
    except ValueError:
        return "unknown", "invalid_peer"
    return str(peer_address), "direct_peer"


def rate_limit_key():
    address, source = resolved_client_address(current_app.config, request.remote_addr)
    g.rate_limit_key_type = "direct_peer"
    g.client_ip_resolution_source = source
    secret = str(current_app.config.get("SECRET_KEY") or "rate-limit-key").encode()
    return hmac.new(secret, address.encode(), hashlib.sha256).hexdigest()


limiter = Limiter(key_func=rate_limit_key, default_limits=[])
