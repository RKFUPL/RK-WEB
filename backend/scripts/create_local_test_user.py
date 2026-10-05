"""Create or update a controlled RK-WEB user in RK_WEB_TEST_DB only."""
import argparse
import getpass
from datetime import datetime, timezone

from bcrypt import gensalt, hashpw

from app import create_app
from app.extensions import mongo


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=("staff", "admin"), default="staff")
    parser.add_argument("--name", default="Local Test User")
    args = parser.parse_args()
    password = getpass.getpass("Local test password: ")
    if len(password) < 12:
        raise SystemExit("Password must be at least 12 characters.")
    app = create_app()
    if app.config.get("MONGO_DBNAME") != "RK_WEB_TEST_DB":
        raise SystemExit("Refusing to run outside RK_WEB_TEST_DB.")
    with app.app_context():
        db = mongo.db or mongo.cx[app.config["MONGO_DBNAME"]]
        now = datetime.now(timezone.utc)
        email = args.email.strip().lower()
        db.users.update_one(
            {"email": email},
            {"$set": {"email": email, "displayName": args.name.strip(), "role": args.role,
                       "isActive": True, "emailVerified": True,
                       "passwordHash": hashpw(password.encode(), gensalt()).decode(), "updatedAt": now},
             "$setOnInsert": {"createdAt": now, "profile": {}}},
            upsert=True,
        )
    print(f"Local {args.role} user prepared in RK_WEB_TEST_DB.")


if __name__ == "__main__":
    main()
