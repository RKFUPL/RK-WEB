from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_mail import Mail
from flask_pymongo import PyMongo
from werkzeug.middleware.proxy_fix import ProxyFix

cors = CORS()
jwt = JWTManager()
limiter = Limiter(key_func=get_remote_address, default_limits=["200 per hour"])
mail = Mail()
mongo = PyMongo()


def configure_trusted_proxy(app):
    """Opt in only after validating the actual trusted proxy hop count.

    Host/protocol/prefix headers never select environment or callback settings.
    With the default zero hops, client-supplied forwarding headers are ignored.
    """
    try:
        hops = int(app.config.get("TRUSTED_PROXY_HOPS", 0))
        if not 0 <= hops <= 5:
            raise ValueError()
    except (TypeError, ValueError):
        raise RuntimeError("TRUSTED_PROXY_HOPS must be an explicit integer from 0 to 5") from None
    if hops:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=0, x_host=0, x_port=0, x_prefix=0)
