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
        image="https://res.cloudinary.com/example/image/upload/saree.jpg"
        product_id=self.database.products.insert({"sku":"HK-173-HP","name":"173 - Hot Pink","slug":"173-hot-pink","category":"Couture","price":125000,"currency":"INR","status":"active","isActive":True,"stock":99,"media":[image],"variants":[{"id":"hot-pink","sku":"HK-173-HP","colour":"Hot Pink","status":"active","sizeInventory":[{"size":"M","stock":7}]}]})
        collection_id=self.database.collections.insert({"name":"Hastakala","slug":"collections-of-hasthkala","productRefs":[{"productId":str(product_id)}]})
        second_collection_id=self.database.collections.insert({"name":"Runway","slug":"runway","productRefs":[{"productId":product_id}]})
        headers={"Authorization":"Bearer bootstrap-test-secret"}
        products=self.client.get("/api/integrations/stock/catalog/products",headers=headers).json["items"]
        categories=self.client.get("/api/integrations/stock/catalog/categories",headers=headers).json["items"]
        collections=self.client.get("/api/integrations/stock/catalog/collections",headers=headers).json["items"]
        self.assertEqual(products[0]["id"],str(product_id))
        self.assertEqual(products[0]["name"],"173 - Hot Pink")
        self.assertEqual(products[0]["collection_ids"],[str(collection_id),str(second_collection_id)])
        self.assertEqual(products[0]["images"],[image])
        self.assertEqual(products[0]["primary_image"],image)
        self.assertEqual(products[0]["media"],[{"url":image,"position":0,"is_primary":True,"source":"rk-web"}])
        self.assertEqual(products[0]["variants"][0]["sizes"],["M"])
        self.assertNotIn("stock",products[0])
        self.assertNotIn("stock",products[0]["variants"][0])
        self.assertEqual(categories,[{"id":"category:couture","name":"Couture","slug":"couture"}])
        self.assertEqual(collections[0]["id"],str(collection_id))

    def test_catalog_write_requires_opt_in_scope_and_is_idempotent_for_media(self):
        with self.app.app_context():
            self.app.config["STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"] = True
        product_id=self.database.products.insert({"sku":"HK-173-HP","name":"173 - Hot Pink","media":["https://res.cloudinary.com/rk/image/upload/original.jpg"]})
        self.provision()
        first_collection=self.database.collections.insert({"name":"Hastakala","productRefs":[]})
        second_collection=self.database.collections.insert({"name":"Runway","productRefs":[]})
        payload={"rk_web_product_id":str(product_id),"sku":"HK-173-HP","name":"173 - Hot Pink","active":True,"collection_ids":[str(first_collection)],"media":[{"url":"https://res.cloudinary.com/rk/image/upload/new.jpg","public_id":"new","source":"rk-stock","position":0,"is_primary":True}]}
        response=self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers={"Authorization":"Bearer bootstrap-test-secret"},json=payload)
        self.assertEqual(response.status_code,200)
        stored=self.database.products.find_one({"_id":product_id})
        self.assertEqual(len(stored["media"]),2)
        self.assertEqual(stored["media"],["https://res.cloudinary.com/rk/image/upload/new.jpg","https://res.cloudinary.com/rk/image/upload/original.jpg"])
        self.assertEqual(stored["rkStockMedia"][0]["public_id"],"new")
        self.assertEqual(len(self.database.collections.find({})[0]["productRefs"]),1)
        self.assertEqual(self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers={"Authorization":"Bearer bootstrap-test-secret"},json=payload).status_code,200)
        self.assertEqual(len(self.database.products.find_one({"_id":product_id})["media"]),2)

    def test_catalog_write_rejects_untrusted_media_and_invalid_collections_before_mutation(self):
        with self.app.app_context():
            self.app.config["STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"] = True
        product_id=self.database.products.insert({"sku":"SAFE-1","name":"Safe","media":["https://res.cloudinary.com/rk/image/upload/web.jpg"]})
        self.provision()
        headers={"Authorization":"Bearer bootstrap-test-secret"}
        base={"rk_web_product_id":str(product_id),"sku":"SAFE-1","name":"Safe","collection_ids":[]}
        untrusted={**base,"media":[{"url":"http://evil.example/image.jpg","public_id":"bad","source":"rk-stock"}]}
        self.assertEqual(self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers=headers,json=untrusted).status_code,400)
        foreign={**base,"media":[{"url":"https://res.cloudinary.com/rk/image/upload/web.jpg","public_id":"web","source":"rk-web"}]}
        self.assertEqual(self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers=headers,json=foreign).status_code,400)
        missing={**base,"collection_ids":[str(ObjectId())],"media":[]}
        self.assertEqual(self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers=headers,json=missing).status_code,400)
        stored=self.database.products.find_one({"_id":product_id})
        self.assertEqual(stored["name"],"Safe")
        self.assertEqual(stored["media"],["https://res.cloudinary.com/rk/image/upload/web.jpg"])

    def test_catalog_write_rejects_duplicate_collection_references(self):
        with self.app.app_context():
            self.app.config["STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"] = True
        product_id=self.database.products.insert({"sku":"SAFE-2","name":"Safe two","media":[]})
        collection_id=self.database.collections.insert({"name":"Hastakala","productRefs":[]})
        self.provision()
        response=self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers={"Authorization":"Bearer bootstrap-test-secret"},json={"rk_web_product_id":str(product_id),"sku":"SAFE-2","name":"Safe two","media":[],"collection_ids":[str(collection_id),str(collection_id)]})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.database.collections.find({})[0]["productRefs"],[])

    def test_existing_connection_does_not_gain_catalog_write_without_reconnect(self):
        self.provision()
        with self.app.app_context():
            self.app.config["STOCK_INTEGRATION_CATALOG_WRITE_ENABLED"] = True
        status=self.client.get("/api/integrations/stock/status",headers={"Authorization":"Bearer bootstrap-test-secret"})
        self.assertNotIn("catalog:write",status.json["scopes"])
        product_id=self.database.products.insert({"sku":"SCOPE-1","name":"Scope test","media":[]})
        denied=self.client.put(f"/api/integrations/stock/catalog/products/{product_id}",headers={"Authorization":"Bearer bootstrap-test-secret"},json={"rk_web_product_id":str(product_id),"sku":"SCOPE-1","name":"Scope test","media":[],"collection_ids":[]})
        self.assertEqual(denied.status_code,403)


if __name__ == "__main__": unittest.main()
