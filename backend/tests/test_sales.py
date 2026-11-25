"""Synthetic campaigns, storage and mocked transports only; no production access."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch, Mock

from bson import ObjectId
from PIL import Image
import pytest
import mongomock.gridfs

mongomock.gridfs.enable_gridfs_integration()

from app.sales import sales_bp, effective_catalog_price, campaign_state, discounted, validate_campaign
from app.rbac import effective_permissions
from app.blueprints.payments.routes import _checkout_items, _revalidate_variant_order_item
from app.catalog import product_view, product_card_view
from test_manual_checkout import shop


@pytest.fixture
def sale_shop(shop):
    db, client, user, product, headers, payload, mail = shop
    client.application.register_blueprint(sales_bp, url_prefix='/api/sales')
    with patch('app.sales.database', return_value=db), patch('app.sales.current_user', return_value=user):
        yield shop


def campaign(db, product, **changes):
    now = datetime.now(timezone.utc)
    row = dict(_id=ObjectId(), title='Synthetic sale', type='festive', slug='synthetic-sale',
               timezone='Asia/Kolkata', publication='published', startsAt=now-timedelta(hours=1),
               endsAt=now+timedelta(hours=1), revision=1, createdAt=now, updatedAt=now,
               items=[dict(id='item-1', productId=str(product['_id']), variantId='colour:ivory', discountPercent=20)])
    row.update(changes)
    db.sale_campaigns.insert_one(row)
    db.admin_settings.update_one({'_id':'store'}, {'$set':{'salePageEnabled':True}})
    return row


def update(client, headers, row, **changes):
    body = {**row, **changes}
    body.pop('_id', None)
    for key in ('startsAt', 'endsAt'):
        if isinstance(body[key], datetime): body[key] = body[key].isoformat()
    return client.put(f"/api/sales/manage/{row['_id']}", headers=headers, json=body)


def test_create_campaign_schedule_timezone_and_cas(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    body=dict(title='Festival',type='custom',customType='Special edit',startsAt='2030-01-01T10:00',endsAt='2030-01-02T10:00',timezone='Asia/Kolkata')
    response=client.post('/api/sales/manage',headers=headers,json=body)
    assert response.status_code==201, response.json
    row=db.sale_campaigns.find_one({'_id':ObjectId(response.json['campaign']['id'])})
    assert row['startsAt'].hour==4 and row['startsAt'].minute==30
    assert row['publication']=='draft' and row['items']==[]
    assert update(client, headers, row, title='New title').status_code==200
    assert update(client, headers, row, title='Lost update').status_code==409
    assert db.sale_campaigns.find_one({'_id':row['_id']})['audit'][0]['action']=='updated'


@pytest.mark.parametrize('changes',[{'type':'bad'},{'type':'custom','customType':''},{'endsAt':'2020-01-01T00:00Z'},{'startsAt':'bad'},{'timezone':'Invalid/Zone'},{'ctaDestination':'//evil.test'},{'ctaDestination':'javascript:alert(1)'}])
def test_reject_invalid_campaign(changes):
    with pytest.raises(ValueError):
        validate_campaign({**dict(title='Sale',type='festive',startsAt='2030-01-01T10:00',endsAt='2030-01-02T10:00',timezone='Asia/Kolkata'),**changes})


@pytest.mark.parametrize('state',['draft','paused','archived','scheduled','expired'])
def test_ineligible_state_never_discounts(sale_shop,state):
    db, client, _, product, *_=sale_shop
    now=datetime.now(timezone.utc)
    changes={'publication':state} if state in ('draft','paused','archived') else {'startsAt':now+timedelta(days=1),'endsAt':now+timedelta(days=2)} if state=='scheduled' else {'endsAt':now-timedelta(seconds=1)}
    row=campaign(db,product,**changes)
    assert campaign_state(row,now)==state
    assert effective_catalog_price(db,product,product['variants'][0],now)['effectivePrice']==1000
    assert client.get('/api/sales/public').status_code==404


def test_visibility_and_active_public_serializers_do_not_mutate_mrp(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product)
    response=client.get('/api/sales/public')
    assert response.status_code==200,response.json
    assert response.json['campaigns'][0]['timezone']=='Asia/Kolkata'
    card=response.json['products'][0]
    assert card['price']==800 and card['sale']['mrp']==1000
    assert card['variants'][0]['price']==800
    assert db.products.find_one({'_id':product['_id']})['price']==1000
    with client.application.test_request_context('/'):
        assert product_view(product)['price']==1000
    assert client.put('/api/sales/visibility',headers=headers,json={'enabled':False}).status_code==200
    assert client.get('/api/sales/public').status_code==404
    assert db.sale_campaigns.count_documents({})==1
    assert effective_catalog_price(db,product,product['variants'][0])['effectivePrice']==1000


@pytest.mark.parametrize('percent',[0,-1,100,101,'NaN','Infinity',None,'invalid'])
def test_discount_validation(percent):
    with pytest.raises(ValueError): discounted(1000,percent)


def test_rounding_uses_inr_half_up():
    assert discounted(103684,20)==82947.20
    assert discounted(135424,35)==88025.60
    assert discounted(95000,15)==80750
    assert discounted(.05,10)==.05


def test_exact_variant_product_wide_and_deterministic_overlap(sale_shop):
    db,_,_,product,*_=sale_shop
    blue={**product['variants'][0],'id':'colour:blue','sku':'PARENT-BLUE','price':2000,'priceMode':'override'}
    product['variants'].append(blue)
    a=campaign(db,product)
    assert effective_catalog_price(db,product,blue)['effectivePrice']==2000
    b=campaign(db,product,slug='second',items=[{'id':'wide','productId':str(product['_id']),'variantId':'','discountPercent':30}])
    assert effective_catalog_price(db,product,blue)['effectivePrice']==1400
    value=effective_catalog_price(db,product,product['variants'][0])
    assert value['effectivePrice']==700 and value['saleCampaignId']==str(b['_id'])
    db.sale_campaigns.update_one({'_id':b['_id']},{'$set':{'items.0.discountPercent':20}})
    assert effective_catalog_price(db,product,product['variants'][0])['saleCampaignId']==min(str(a['_id']),str(b['_id']))
    db.sale_campaigns.update_many({},{'$set':{'items':[]}})
    assert effective_catalog_price(db,product,blue)['effectivePrice']==2000


def test_assignments_reject_duplicates_removed_variants_and_invalid_prices(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product)
    item=row['items'][0]
    for items in ([item,item],[{**item,'variantId':'removed'}],[{**item,'discountPercent':100}]):
        assert update(client,headers,row,items=items).status_code==400
    db.products.update_one({'_id':product['_id']},{'$set':{'status':'archived'}})
    assert update(client,headers,row,items=[{**item,'discountPercent':21}]).status_code==400
    assert update(client,headers,row,publication='paused').status_code==200
    assert client.get('/api/sales/public').status_code==404


def test_staff_permission_is_explicit_and_enforced(sale_shop):
    db,client,user,product,headers,*_=sale_shop
    assert 'sales:manage' not in effective_permissions({'role':'staff'})
    assert 'sales:manage' not in effective_permissions({'role':'staff','permissions':[]})
    assert 'sales:manage' in effective_permissions({'role':'admin'})
    user.update(role='staff',permissions=[])
    assert client.get('/api/sales/manage',headers=headers).status_code==403
    user['permissions']=['sales:manage']
    assert client.get('/api/sales/manage',headers=headers).status_code==200
    assert client.put('/api/sales/visibility',headers=headers,json={'enabled':True}).status_code==403


def test_canonical_checkout_snapshot_expiry_and_untrusted_price(sale_shop):
    db,client,_,product,headers,payload,_=sale_shop
    row=campaign(db,product)
    payload['cart'][0].update(price=1,mrp=1,salePrice=1,discountPercent=99)
    response=client.post('/api/payments/razorpay/order',headers=headers,json=payload)
    assert response.status_code==201,response.json
    order=db.orders.find_one({'_id':ObjectId(response.json['order']['id'])})
    assert order['total']==800 and order['amountPaise']==80000
    assert order['items'][0]['mrp']==1000 and order['items'][0]['unitPrice']==800
    assert order['items'][0]['sale']['discountPercent']==20
    db.sale_campaigns.update_one({'_id':row['_id']},{'$set':{'endsAt':datetime.now(timezone.utc)-timedelta(seconds=1)}})
    assert _checkout_items(db,payload['cart'])[1]==1000
    # Capture still validates the saved MRP/identity, rather than demanding an expired discount.
    _revalidate_variant_order_item(db,order['items'][0])
    assert db.orders.find_one({'_id':order['_id']})['total']==800


def test_expired_cart_gets_updated_price_response_before_order(sale_shop):
    db,client,_,product,headers,payload,_=sale_shop
    campaign(db,product,endsAt=datetime.now(timezone.utc)-timedelta(seconds=1))
    payload['cart'][0]['quotedUnitPrice']=800
    response=client.post('/api/payments/razorpay/order',headers=headers,json=payload)
    assert response.status_code==409 and response.json['code']=='price_changed'
    assert response.json['prices'][0]['price']==1000
    assert db.orders.count_documents({})==0
    payload['cart'][0]['quotedUnitPrice']=1000
    assert client.post('/api/payments/razorpay/order',headers=headers,json=payload).status_code==201


def test_catalog_picker_search_collection_and_mrp(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    campaign(db,product)
    cid=ObjectId()
    db.collections.insert_one({'_id':cid,'name':'Synthetic collection','slug':'synthetic','productRefs':[{'productId':product['_id']}]})
    data=client.get(f'/api/sales/products?collection={cid}&q=PARENT-IVORY',headers=headers).json
    assert len(data['products'])==1
    assert data['products'][0]['price']==1000
    assert client.get('/api/sales/products?q=missing',headers=headers).json['products']==[]


def test_sale_picker_loads_canonical_collection_products_and_searches_variant_metadata(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    first_collection, second_collection = ObjectId(), ObjectId()
    second_product = deepcopy(product)
    second_product['_id'] = ObjectId()
    second_product.update(name='Nayra Embroidered Saree', productCode='NK-213', styleCode='NK-213', sku='NAYRA-PARENT')
    second_product['variants'] = [{**second_product['variants'][0], 'id': 'royal-blue', 'sku': 'NAYRA-ROYAL-BLUE', 'colour': 'Royal Blue'}]
    db.products.insert_one(second_product)
    inactive = deepcopy(second_product)
    inactive['_id'] = ObjectId()
    inactive.update(name='Archived Nayra', status='archived', sku='ARCHIVED-NAYRA')
    db.products.insert_one(inactive)
    db.collections.insert_many([
        {'_id': first_collection, 'name': 'AAKAAR', 'slug': 'aakaar', 'status': 'collection', 'productRefs': [
            {'productId': product['_id']}, {'productId': product['_id']}, {'productId': second_product['_id']}, {'productId': inactive['_id']}]},
        {'_id': second_collection, 'name': 'Hastakala', 'slug': 'hastakala', 'status': 'collection', 'productRefs': [{'productId': product['_id']}]},
    ])

    all_aakaar = client.get(f'/api/sales/products?collection={first_collection}', headers=headers).json
    assert {item['id'] for item in all_aakaar['products']} == {str(product['_id']), str(second_product['_id'])}
    assert all_aakaar['count'] == 2
    assert all(item['collections'][0]['name'] in {'AAKAAR', 'Hastakala'} for item in all_aakaar['products'])

    nayra = client.get(f'/api/sales/products?collection={first_collection}&q=NAYRA', headers=headers).json['products']
    assert [item['id'] for item in nayra] == [str(second_product['_id'])]
    by_variant_sku = client.get(f'/api/sales/products?collection={first_collection}&q=ROYAL-BLUE', headers=headers).json['products']
    assert [item['id'] for item in by_variant_sku] == [str(second_product['_id'])]
    other_collection = client.get(f'/api/sales/products?collection={second_collection}', headers=headers).json['products']
    assert [item['id'] for item in other_collection] == [str(product['_id'])]
    assert client.get('/api/sales/products?collection=000000000000000000000099', headers=headers).status_code == 404


def test_campaign_details_and_product_assignment_updates_are_independent(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    row = campaign(db, product, publication='draft')
    before = db.sale_campaigns.find_one({'_id': row['_id']})
    # A details-only save omits items; the existing assignment remains intact.
    details = client.put(f"/api/sales/manage/{row['_id']}", headers=headers, json={
        'revision': 1, 'title': 'Updated campaign details', 'description': 'Details only',
        'startsAt': before['startsAt'].isoformat(), 'endsAt': before['endsAt'].isoformat(),
        'timezone': before['timezone'], 'type': before['type'], 'publication': 'draft',
    })
    assert details.status_code == 200
    after_details = db.sale_campaigns.find_one({'_id': row['_id']})
    assert after_details['items'] == before['items']
    updated_item = {**before['items'][0], 'discountPercent': 25}
    products = client.put(f"/api/sales/manage/{row['_id']}", headers=headers, json={'revision': 2, 'items': [updated_item]})
    assert products.status_code == 200
    after_products = db.sale_campaigns.find_one({'_id': row['_id']})
    assert after_products['title'] == 'Updated campaign details'
    assert after_products['description'] == 'Details only'
    assert after_products['items'][0]['discountPercent'] == 25


def test_campaign_cannot_be_published_without_eligible_sale_assignment(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    row = campaign(db, product, publication='draft', items=[])
    response = client.put(f"/api/sales/manage/{row['_id']}", headers=headers, json={'revision': 1, 'publication': 'published'})
    assert response.status_code == 400
    assert 'at least one eligible sale product' in response.json['error']
    assert db.sale_campaigns.find_one({'_id': row['_id']})['publication'] == 'draft'


def test_banner_upload_validation_replacement_removal_and_private_preview(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product,publication='draft')
    path=f"/api/sales/manage/{row['_id']}/banner"
    assert client.post(path,headers=headers,data={'revision':'1','file':(BytesIO(b'not an image'),'bad.png','image/png')}).status_code==400
    output=BytesIO(); Image.new('RGB',(20,10),'ivory').save(output,format='PNG'); image=output.getvalue()
    response=client.post(path,headers=headers,data={'revision':'1','file':(BytesIO(image),'banner.png','image/png')})
    assert response.status_code==200,response.json
    assert client.get(path,headers=headers).mimetype=='image/jpeg'
    assert client.get(f"/api/sales/{row['_id']}/banner").status_code==404
    first=response.json['campaign']['bannerUrl']
    download=Mock(); download.file_id='synthetic123'; download.response.headers={'Content-Type':'image/png'}; download.response.iter_content.return_value=[image]
    with patch('app.workdrive.download_file',return_value=download):
        response=client.post(path,headers=headers,json={'revision':2,'workdriveLink':'https://workdrive.zoho.in/file/synthetic123'})
        assert response.status_code==200,response.json
        assert response.json['campaign']['bannerUrl']!=first
    assert client.delete(path,headers=headers,json={'revision':3}).status_code==200
    assert 'bannerData' not in db.sale_campaigns.find_one({'_id':row['_id']})


def test_video_upload_uses_gridfs_and_supports_range_streaming(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    row = campaign(db, product, publication='draft')
    video = b'\x00\x00\x00\x18ftypisom' + b'\x00' * 80
    import io
    files = {}
    class GridFile(io.BytesIO):
        def __init__(self, data): super().__init__(data); self.length=len(data)
    class Bucket:
        def __init__(self, *_args, **_kwargs): pass
        def upload_from_stream(self, _name, data, **_kwargs):
            key=ObjectId();files[key]=data;return key
        def open_download_stream(self, key): return GridFile(files[key])
        def delete(self, key): files.pop(key,None)
    path = f"/api/sales/manage/{row['_id']}/banner"
    with patch('app.sales.GridFSBucket', Bucket):
        response = client.post(path, headers=headers, data={
            'revision': '1', 'file': (BytesIO(video), 'campaign.mp4', 'video/mp4')
        })
    assert response.status_code == 200, response.json
    saved = db.sale_campaigns.find_one({'_id': row['_id']})
    assert saved['bannerMediaType'] == 'video'
    assert saved['bannerMimeType'] == 'video/mp4'
    assert saved['bannerMediaSource'] == 'upload'
    assert saved['bannerMediaId']
    assert 'bannerData' not in saved
    # Range requests are served from the persisted GridFS file, not the upload buffer.
    with patch('app.sales.GridFSBucket', Bucket):
        playback = client.get(f"/api/sales/manage/{row['_id']}/banner-media", headers={**headers, 'Range': 'bytes=0-11'})
    assert playback.status_code == 206
    assert playback.headers['Accept-Ranges'] == 'bytes'
    assert playback.data == video[:12]


@pytest.mark.parametrize(('mime', 'filename', 'signature'), [
    ('image/jpeg', 'banner.jpg', b'\xff\xd8\xff\xe0synthetic'),
    ('image/png', 'banner.png', b'\x89PNG\r\n\x1a\nsynthetic'),
    ('image/webp', 'banner.webp', b'RIFF\x04\x00\x00\x00WEBPsynthetic'),
    ('video/mp4', 'banner.mp4', b'\x00\x00\x00\x18ftypisom0000'),
    ('video/quicktime', 'banner.mov', b'\x00\x00\x00\x18ftypqt 0000'),
    ('video/webm', 'banner.webm', b'\x1a\x45\xdf\xa3synthetic'),
    ('video/x-m4v', 'banner.m4v', b'\x00\x00\x00\x18ftypisom0000'),
])
def test_campaign_upload_media_mime_extension_and_signature(mime, filename, signature):
    from app.campaign_media import inspect_uploaded_media
    result = inspect_uploaded_media(signature, mime, filename)
    assert result['mimeType'] == mime
    assert result['mediaType'] == ('image' if mime.startswith('image/') else 'video')


def test_campaign_upload_rejects_extension_mime_and_signature_mismatch():
    from app.campaign_media import CampaignMediaError, inspect_uploaded_media
    with pytest.raises(CampaignMediaError, match='extension'):
        inspect_uploaded_media(b'\x00\x00\x00\x18ftypisom', 'video/mp4', 'banner.png')
    with pytest.raises(CampaignMediaError, match='contents'):
        inspect_uploaded_media(b'<html>not media</html>', 'video/mp4', 'banner.mp4')
    with pytest.raises(CampaignMediaError, match='size limit'):
        inspect_uploaded_media(b'x' * (100 * 1024 * 1024 + 1), 'video/mp4', 'large.mp4')


def test_workdrive_video_is_copied_to_private_media_storage(sale_shop):
    db, client, _, product, headers, *_ = sale_shop
    row = campaign(db, product, publication='draft')
    video = b'\x00\x00\x00\x18ftypisom0000'
    class Stream:
        length = len(video)
        def iter_content(self, chunk_size):
            assert chunk_size <= 65536
            yield video
        def close(self): pass
    class Bucket:
        files = {}
        def __init__(self, _db, bucket_name): assert bucket_name == 'sale_banner_media'
        def upload_from_stream(self, filename, data, metadata=None):
            self.files['media-1'] = bytes(data)
            return 'media-1'
        def open_download_stream(self, key):
            stream = BytesIO(self.files[key]); stream.length = len(self.files[key]); return stream
        def delete(self, key): self.files.pop(key, None)
    download = SimpleNamespace(file_id='workdrive-file-id', response=Stream())
    download.response.headers = {'Content-Type': 'video/mp4', 'Content-Length': str(len(video))}
    with patch('app.sales.GridFSBucket', Bucket), patch('app.workdrive.download_file', return_value=download):
        response = client.post(f"/api/sales/manage/{row['_id']}/banner", headers=headers,
                               json={'revision': 1, 'mediaUrl': 'https://workdrive.zoho.in/file/syntheticVideo'})
    assert response.status_code == 200, response.json
    saved = db.sale_campaigns.find_one({'_id': row['_id']})
    assert saved['bannerMediaType'] == 'video'
    assert saved['bannerMediaSource'] == 'workdrive'
    assert saved['bannerWorkDriveFileId'] == 'workdrive-file-id'
    assert 'downloadUrl' not in saved and 'accessToken' not in saved
    assert Bucket.files['media-1'] == video


def test_cloudinary_video_url_is_verified_and_persisted_without_rewriting(sale_shop):
    import socket
    from app.campaign_media import verify_external_url

    db, client, _, product, headers, *_ = sale_shop
    row = campaign(db, product, publication='draft')
    url = 'https://res.cloudinary.com/fm1bwbrd/video/upload/v1785305865/39_-_RK_Kalkatta_Interior_ivhomn.mp4'

    class Response:
        def __init__(self, status, headers, chunks=()):
            self.status_code = status; self.headers = headers; self.ok = 200 <= status < 400
            self.is_redirect = self.is_permanent_redirect = False; self._chunks = chunks
        def iter_content(self, chunk_size): return iter(self._chunks)
        def close(self): pass

    class Session:
        trust_env = True
        def request(self, method, requested, **kwargs):
            assert requested == url
            if method == 'HEAD': return Response(200, {'Content-Type':'video/mp4','Content-Length':'123456'})
            return Response(206, {'Content-Type':'video/mp4','Content-Range':'bytes 0-15/123456'}, [b'\x00\x00\x00\x18ftypisom'])
        def close(self): pass

    address = (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))
    with patch('app.campaign_media.socket.getaddrinfo', return_value=[address]), patch('app.campaign_media.requests.Session', return_value=Session()):
        verified = verify_external_url(url)
        response = client.post(f"/api/sales/manage/{row['_id']}/banner", headers=headers,
                               json={'revision':1,'mediaUrl':url})
    assert verified['mediaType'] == 'video' and verified['mimeType'] == 'video/mp4'
    assert response.status_code == 200, response.json
    saved = db.sale_campaigns.find_one({'_id': row['_id']})
    assert saved['bannerMediaUrl'] == url
    assert saved['bannerMediaType'] == 'video'
    assert saved['bannerMediaSource'] == 'external'
    assert saved.get('bannerMediaId') is None


def test_external_banner_verifier_rejects_html_and_private_redirects():
    import socket
    from app.campaign_media import CampaignMediaError, verify_external_url

    class Response:
        ok = True; status_code = 200; is_permanent_redirect = False
        def __init__(self, headers, chunks=(), redirect=False):
            self.headers=headers; self._chunks=chunks; self.is_redirect=redirect
        def iter_content(self, chunk_size): return iter(self._chunks)
        def close(self): pass
    class Session:
        trust_env = True
        def __init__(self, redirect=False): self.redirect=redirect
        def request(self, method, url, **kwargs):
            if self.redirect: return Response({'Location':'https://127.0.0.1/private'}, redirect=True)
            return Response({'Content-Type':'text/html','Content-Length':'12'}, [b'<html>no</html>'])
        def close(self): pass
    address = (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('93.184.216.34', 443))
    with patch('app.campaign_media.socket.getaddrinfo', return_value=[address]), patch('app.campaign_media.requests.Session', return_value=Session()):
        with pytest.raises(CampaignMediaError, match='supported image or video'):
            verify_external_url('https://public.example/banner')
    with patch('app.campaign_media.socket.getaddrinfo', return_value=[address]), patch('app.campaign_media.requests.Session', return_value=Session(redirect=True)):
        with pytest.raises(CampaignMediaError, match='Private and local'):
            verify_external_url('https://public.example/banner')


def test_price_revalidation_endpoint_uses_exact_variant(sale_shop):
    db,client,_,product,*_=sale_shop
    campaign(db,product)
    response=client.post('/api/sales/prices',json={'items':[{'productId':str(product['_id']),'variantId':'colour:ivory','price':1}]})
    assert response.json['prices'][0]['price']==800
    assert client.post('/api/sales/prices',json={'items':[{'productId':str(product['_id']),'variantId':'wrong'}]}).json['prices']==[]


def test_razorpay_amount_and_refund_ceiling_use_saved_sale_snapshot(sale_shop):
    from app.refund_evidence import captured_paise, verified_refunds
    db,client,_,product,headers,payload,_=sale_shop
    campaign(db,product)
    db.admin_settings.update_one({'_id':'store'},{'$set':{'razorpayEnabled':True}})
    with patch('app.blueprints.payments.routes.is_configured',return_value=True), patch('app.blueprints.payments.routes.razorpay_api_request',return_value={'id':'order_synthetic'}) as provider:
        response=client.post('/api/payments/razorpay/order',headers=headers,json=payload)
    assert response.status_code==201,response.json
    assert provider.call_args.args[3]['amount']==80000
    order=db.orders.find_one({'_id':ObjectId(response.json['order']['id'])})
    order.update(paymentGateway='razorpay',razorpayPaymentId='pay_synthetic',paymentVerifiedAt=datetime.now(timezone.utc))
    assert captured_paise(order)==80000
    refund={'id':'refund_synthetic','status':'processed','source':'razorpay_signed_webhook','paymentId':'pay_synthetic','currency':'INR','processedAt':datetime.now(timezone.utc),'amountPaise':80000}
    assert verified_refunds({**order,'refunds':[refund]})==[refund]
    with pytest.raises(ValueError,match='exceed'):
        verified_refunds({**order,'refunds':[{**refund,'amountPaise':100000}]})


def test_exact_end_boundary_and_missing_variant_evidence_fail_closed(sale_shop):
    db,_,_,product,*_=sale_shop
    row=campaign(db,product)
    end=db.sale_campaigns.find_one({'_id':row['_id']})['endsAt']
    assert effective_catalog_price(db,product,product['variants'][0],end-timedelta(microseconds=1))['isOnSale']
    assert not effective_catalog_price(db,product,product['variants'][0],end)['isOnSale']
    for field in ('id','sku'):
        variant=deepcopy(product['variants'][0]);variant.pop(field)
        assert not effective_catalog_price(db,product,variant)['isOnSale']


def test_assignment_identity_and_sku_evidence_are_server_owned(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product)
    response=update(client,headers,row,items=[{**row['items'][0],'id':'untrusted-id'}])
    assert response.status_code==200
    saved=db.sale_campaigns.find_one({'_id':row['_id']})
    assert saved['items'][0]['id']=='item-1'
    assert saved['items'][0]['targetSkus']==[{'variantId':'colour:ivory','sku':'PARENT-IVORY'}]
    assert effective_catalog_price(db,product,product['variants'][0])['isOnSale']
    renamed={**product['variants'][0],'sku':'UNRELATED-SKU'}
    assert not effective_catalog_price(db,product,renamed)['isOnSale']


def test_stale_banner_editor_cannot_advance_revision_over_a_newer_campaign(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product)
    path=f"/api/sales/manage/{row['_id']}/banner"
    assert update(client,headers,row,publication='paused',title='Newer staff edit').status_code==200
    with patch('app.workdrive.download_file',side_effect=AssertionError('Stale edits must stop before provider access.')):
        response=client.post(path,headers=headers,json={'revision':1,'workdriveLink':'https://workdrive.zoho.in/file/synthetic123'})
    assert response.status_code==409
    assert client.delete(path,headers=headers,json={'revision':1}).status_code==409
    saved=db.sale_campaigns.find_one({'_id':row['_id']})
    assert saved['revision']==2 and saved['publication']=='paused' and saved['title']=='Newer staff edit'
    assert 'bannerData' not in saved


def test_campaign_change_during_banner_download_is_fenced(sale_shop):
    db,client,_,product,headers,*_=sale_shop
    row=campaign(db,product)
    output=BytesIO(); Image.new('RGB',(20,10),'ivory').save(output,format='PNG')
    def download(*_args,**_kwargs):
        db.sale_campaigns.update_one({'_id':row['_id']},{'$set':{'publication':'paused'},'$inc':{'revision':1}})
        result=Mock();result.file_id='synthetic123';result.response.headers={'Content-Type':'image/png'};result.response.iter_content.return_value=[output.getvalue()]
        return result
    with patch('app.workdrive.download_file',side_effect=download):
        response=client.post(f"/api/sales/manage/{row['_id']}/banner",headers=headers,json={'revision':1,'workdriveLink':'https://workdrive.zoho.in/file/synthetic123'})
    assert response.status_code==409
    saved=db.sale_campaigns.find_one({'_id':row['_id']})
    assert saved['revision']==2 and saved['publication']=='paused' and 'bannerData' not in saved


def test_aakaar_admin_and_sale_share_five_product_identities_and_exclusions(sale_shop):
    from app.catalog import collection_product_documents
    from app.blueprints.staff.routes import _management_collection_payload
    db, client, _, prototype, headers, *_ = sale_shop
    rows = []
    for index, name in enumerate(['CK02', 'CK05', 'T0', 'AURELIA', 'T2']):
        product = deepcopy(prototype)
        product.update(_id=ObjectId(), name=name, sku='T1' if name == 'AURELIA' else name,
                       status='active' if name == 'AURELIA' else 'draft', price=188004 if name == 'AURELIA' else 1500)
        product['variants'] = [{**product['variants'][0], 'id':'colour:blue', 'sku':name+'-BLUE', 'colour':'Blue', 'priceMode':'inherit', 'price':product['price']}]
        db.products.insert_one(product)
        rows.append(product)
    collection = dict(_id=ObjectId(), name='AAKAAR', slug='aakaar', status='collection', productRefs=[
        {'productId':str(product['_id']), 'displayOrder':index} for index, product in enumerate(rows)])
    collection['productRefs'] += [{'productId': rows[3]['_id'], 'displayOrder':99}, {'productId':'invalid'}, None, {}]
    db.collections.insert_one(collection)
    with client.application.test_request_context(), patch('app.blueprints.staff.routes.managed_collections', return_value=[collection]):
        admin = _management_collection_payload(db, collection)['collection']['products']
    assert [p['id'] for p in admin] == [str(p['_id']) for p in rows]
    assert len(collection_product_documents(db, collection)) == 5
    response = client.get('/api/sales/products', query_string={'collection':str(collection['_id'])}, headers=headers)
    assert response.status_code == 200
    data = response.json
    assert data['totalCount'] == 5 and data['eligibleCount'] == 1
    assert [p['id'] for p in data['products']] == [str(rows[3]['_id'])]
    assert data['products'][0]['price'] == 188004
    assert {p['id'] for p in data['products'] + data['excludedProducts']} == {p['id'] for p in admin}
    assert all('Inactive' in p['reasons'][0] for p in data['excludedProducts'])
    for query in ['AURELIA', 'AURELIA-BLUE']:
        found = client.get('/api/sales/products', query_string={'collection':str(collection['_id']), 'q':query}, headers=headers).json
        assert [p['id'] for p in found['products']] == [str(rows[3]['_id'])]
    assert client.get('/api/sales/products', query_string={'collection':str(collection['_id']), 'q':''}, headers=headers).json['count'] == 1
