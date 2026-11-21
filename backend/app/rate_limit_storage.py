"""Keep MongoDB rate-limit cleanup lazy, including in short-lived Flask CLIs."""
from limits.storage.mongodb import MongoDBStorage


class ShutdownSafeMongoDBStorage(MongoDBStorage):
    # limits 5.8.0's __del__ reads the lazy storage property, creating a client
    # during interpreter shutdown even when this process never used the limiter.
    # Register the same URI schemes and inherit all rate-limit operations as-is.
    STORAGE_SCHEME = ["mongodb", "mongodb+srv"]

    def __del__(self):
        client = getattr(self, "_storage", None)
        if client is not None:
            self._storage = None
            client.close()
