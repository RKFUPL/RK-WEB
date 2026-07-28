from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_mail import Mail
from flask_pymongo import PyMongo

cors = CORS()
jwt = JWTManager()
limiter = Limiter(key_func=get_remote_address, default_limits=["200 per hour"])
mail = Mail()
mongo = PyMongo()
