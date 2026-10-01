import hashlib
import unittest
from unittest.mock import patch

from bson import ObjectId
from flask import Flask

from app.blueprints.integrations.routes import integrations_bp


class MemoryCollection:
    def __init__(self):
        self.documents = {}
    def find_one(self, query):
        for document in self.documents.values():
            if all((key not in document if isinstance(value,dict) and value.get("$exists") is False else document.get(key)==value) for key,value in query.items()):
                return dict(document)
        return None
    def update_one(self, query, update, upsert=False):
        document=self.find_one(query)
        key=(document or {}).get("_id") or query.get("_id")
        if document is None and not upsert: return
        document=document or dict(query)
        document.update(update.get("$set",{}))
        for field in update.get("$unset",{}): document.pop(field,None)
        self.documents[key]=document
    def find(self, query=None, projection=None):
        return [dict(document) for document in self.documents.values()]
    def distinct(self, field):
        return list({document.get(field) for document in self.documents.values() if document.get(field) is not None})
    def insert(self, document):
        key=document.get("_id") or ObjectId()
        self.documents[key]={**document,"_id":key}
        return key


class Database:
    def __init__(self):
        self.service_connections=MemoryCollection()
        self.products=MemoryCollection()
        self.collections=MemoryCollection()


class StockIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__)
        self.app.config.update(TESTING=True,STOCK_INTEGRATION_BOOTSTRAP_SECRET="bootstrap-test-secret",STOCK_INTEGRATION_CLIENT_ID="rk-stock-linesheets")
        self.app.register_blueprint(integrations_bp,url_prefix="/api/integrations")
        self.database=Database()
        self.patch=patch("app.blueprints.integrations.routes.database",return_value=self.database)
        self.patch.start()
        self.client=self.app.test_client()
    def tearDown(self): self.patch.stop()
    def provision(self):
        return self.client.post("/api/integrations/stock/connect",headers={"Authorization":"Bearer bootstrap-test-secret"},json={"client_id":"rk-stock-linesheets"})
    def test_missing_credentials_are_rejected(self):
        response=self.client.post("/api/integrations/stock/connect",json={"client_id":"rk-stock-linesheets"})
        self.assertEqual(response.status_code,401)
        self.assertNotIn("bootstrap-test-secret", response.get_data(as_text=True))
    def test_wrong_client_id_is_rejected(self):
        response=self.client.post("/api/integrations/stock/connect",headers={"Authorization":"Bearer bootstrap-test-secret"},json={"client_id":"another-client"})
        self.assertEqual(response.status_code,401)
    def test_repeated_connect_is_idempotent(self):
        first=self.provision()
        second=self.provision()
        self.assertEqual(first.status_code,201)
        self.assertEqual(second.status_code,200)
        self.assertEqual(first.json["connection_id"],second.json["connection_id"])
        self.assertEqual(second.json["status"],"connected")
    def test_successful_authentication_stores_only_hash_and_least_privilege(self):
        response=self.provision()
        self.assertEqual(response.status_code,201)
        document=next(iter(self.database.service_connections.documents.values()))
        self.assertNotIn("service_token",response.json)
        self.assertNotIn("bootstrap-test-secret",response.get_data(as_text=True))
        self.assertEqual(document["tokenHash"],hashlib.sha256(b"bootstrap-test-secret").hexdigest())
        self.assertEqual(document["scopes"],["connection:status"])
        status=self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer bootstrap-test-secret"})
        self.assertEqual(status.status_code,200)
        self.assertEqual(status.json["status"],"connected")
    def test_rejected_bootstrap_and_service_credentials(self):
        bad=self.client.post("/api/integrations/stock/connect",headers={"Authorization":"Bearer wrong"},json={"client_id":"rk-stock-linesheets"})
        self.assertEqual(bad.status_code,401)
        self.assertEqual(self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer wrong"}).status_code,401)
    def test_rotation_invalidates_previous_token(self):
        self.provision()
        with self.app.app_context(): self.app.config["STOCK_INTEGRATION_BOOTSTRAP_SECRET"]="rotated-test-secret"
        rotated=self.client.post("/api/integrations/stock/connect",headers={"Authorization":"Bearer rotated-test-secret"},json={"client_id":"rk-stock-linesheets"})
        self.assertEqual(rotated.status_code,201)
        self.assertEqual(self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer bootstrap-test-secret"}).status_code,401)
        self.assertEqual(self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer rotated-test-secret"}).status_code,200)
    def test_disconnect_revokes_token_without_deleting_record(self):
        self.provision()
        disconnected=self.client.post("/api/integrations/stock/disconnect",headers={"Authorization":"Bearer bootstrap-test-secret"})
        self.assertEqual(disconnected.status_code,200)
        self.assertEqual(self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer bootstrap-test-secret"}).status_code,401)
        self.assertEqual(len(self.database.service_connections.documents),1)
    def test_catalog_endpoints_require_service_authentication(self):
        for path in ("products","categories","collections"):
            self.assertEqual(self.client.get(f"/api/integrations/stock/catalog/{path}").status_code,401)
            self.assertEqual(self.client.get(f"/api/integrations/stock/catalog/{path}",headers={"Authorization":"Bearer wrong"}).status_code,401)
    def test_authenticated_catalog_endpoints_return_safe_catalog_fields(self):
        self.provision()
        product_id=self.database.products.insert({"sku":"RK-100","name":"Saree","slug":"saree","category":"Saree","price":1000,"currency":"INR","status":"active","isActive":True,"stock":99,"variants":[{"id":"red","sku":"RK-100-RED","colour":"Red","status":"active","sizeInventory":[{"size":"M","stock":7}]}]})
        collection_id=self.database.collections.insert({"name":"Aakaar","slug":"aakaar","productRefs":[{"productId":product_id}]})
        headers={"Authorization":"Bearer bootstrap-test-secret"}
        products=self.client.get("/api/integrations/stock/catalog/products",headers=headers).json["items"]
        categories=self.client.get("/api/integrations/stock/catalog/categories",headers=headers).json["items"]
        collections=self.client.get("/api/integrations/stock/catalog/collections",headers=headers).json["items"]
        self.assertEqual(products[0]["id"],str(product_id))
        self.assertEqual(products[0]["collection_ids"],[str(collection_id)])
        self.assertEqual(products[0]["variants"][0]["sizes"],["M"])
        self.assertNotIn("stock",products[0])
        self.assertNotIn("stock",products[0]["variants"][0])
        self.assertEqual(categories,[{"id":"category:saree","name":"Saree","slug":"saree"}])
        self.assertEqual(collections[0]["id"],str(collection_id))


if __name__ == "__main__": unittest.main()
