"""Opt-in in-memory browser fixture. Never reads .env or constructs a real MongoClient."""
import os
import sys
from pathlib import Path
if os.environ.get('RK_SALE_BROWSER_FIXTURE') != '1':
    raise SystemExit('Synthetic sale browser fixture requires explicit opt-in.')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
from io import BytesIO
from types import SimpleNamespace
from PIL import Image
from bson import ObjectId
import mongomock
from flask import Flask, jsonify, request
from flask_jwt_extended import JWTManager, create_access_token
patch('dotenv.load_dotenv', return_value=False).start()
patch('dotenv.dotenv_values', return_value={}).start()
from app.sales import sales_bp
from app.blueprints.catalog.routes import catalog_bp
from app.blueprints.payments.routes import payments_bp
from app.extensions import limiter

app = Flask(__name__)
app.config.update(TESTING=True, JWT_SECRET_KEY='synthetic-browser-fixture-signing-key-only', RATELIMIT_ENABLED=False,
                  WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False, WHATSAPP_APP_SECRET='synthetic-sale-test-secret')
JWTManager(app)
limiter.init_app(app)
db = mongomock.MongoClient(tz_aware=True).synthetic_sales_browser
_sale_media_files = {}

class _MediaStream(BytesIO):
    def __init__(self, value):
        super().__init__(value)
        self.length = len(value)

class _FixtureGridFSBucket:
    def __init__(self, _db, bucket_name='sale_banner_media'):
        self.bucket_name = bucket_name
    def upload_from_stream(self, _filename, value, metadata=None):
        file_id = ObjectId()
        _sale_media_files[file_id] = bytes(value)
        return file_id
    def open_download_stream(self, file_id):
        if file_id not in _sale_media_files:
            raise FileNotFoundError()
        return _MediaStream(_sale_media_files[file_id])
    def delete(self, file_id):
        _sale_media_files.pop(file_id, None)

patch('app.sales.GridFSBucket', _FixtureGridFSBucket).start()
user = {'_id': ObjectId('000000000000000000000001'), 'role':'admin', 'isActive':True, 'email':'synthetic@example.test', 'firstName':'Synthetic'}
for target in ('app.rbac.database','app.sales.database','app.blueprints.catalog.routes.database','app.blueprints.payments.routes.database'):
    patch(target, return_value=db).start()
for target in ('app.rbac.current_user','app.sales.current_user','app.blueprints.payments.routes.current_user'):
    patch(target, side_effect=lambda:user).start()
patch('app.blueprints.payments.routes.ensure_catalog_seed').start()
patch('app.blueprints.payments.routes.sync_product_variants', side_effect=lambda db,p:p).start()
patch('app.order_confirmation.send_html_email', return_value={'id':'synthetic-mail'}).start()
patch('app.order_fulfillment.send_html_email', return_value={'id':'synthetic-status'}).start()
# Any accidental provider traffic is a test failure.
patch('requests.sessions.Session.request', side_effect=AssertionError('External HTTP is forbidden in sale browser tests.')).start()
patch('smtplib.SMTP', side_effect=AssertionError('SMTP is forbidden.')).start()
patch('smtplib.SMTP_SSL', side_effect=AssertionError('SMTP is forbidden.')).start()


def synthetic_workdrive_download(link, *_args, **_kwargs):
    if link != 'https://workdrive.zoho.in/file/synthetic123':
        raise ValueError('Synthetic WorkDrive file is unavailable.')
    output = BytesIO()
    Image.new('RGB', (40, 20), 'ivory').save(output, format='PNG')
    response = Mock()
    response.headers = {'Content-Type': 'image/png'}
    response.iter_content.return_value = [output.getvalue()]
    return SimpleNamespace(response=response, file_id='synthetic123')


patch('app.workdrive.download_file', side_effect=synthetic_workdrive_download).start()
from app.blueprints.staff.routes import staff_bp
patch('app.blueprints.staff.routes.database',return_value=db).start()
patch('app.blueprints.staff.routes.current_user',side_effect=lambda:user).start()
patch('app.catalog.ensure_catalog_seed').start()
patch('app.blueprints.staff.routes.ensure_catalog_seed').start()
app.register_blueprint(staff_bp,url_prefix='/api/staff')
app.register_blueprint(sales_bp,url_prefix='/api/sales')
app.register_blueprint(catalog_bp,url_prefix='/api/catalog')
app.register_blueprint(payments_bp,url_prefix='/api/payments')


@app.post('/__fixture/reset')
def reset():
    _sale_media_files.clear()
    for collection in db.list_collection_names(): db[collection].delete_many({})
    user.update(role='admin',permissions=[])
    user.update(request.get_json(silent=True) or {})
    db.users.insert_one(dict(user))
    db.admin_settings.insert_one({'_id':'store','razorpayEnabled':False,'salePageEnabled':True})
    pid=ObjectId('000000000000000000000002')
    db.products.insert_one({'_id':pid,'name':'Synthetic Couture','sku':'RK-SYN','price':1000,'status':'active','isActive':True,'availability':'in_stock','category':'Lehenga','media':[], 'attributes':{},
        'variants':[{'id':'ivory','sku':'RK-SYN-IVORY','colour':'IVORY','colourSlug':'ivory','status':'active','price':1000,'priceMode':'inherit','sizes':['S','M'],'stock':4,'sizeInventory':[{'size':'S','stock':4}],'images':[]},
                    {'id':'blue','sku':'RK-SYN-BLUE','colour':'BLUE','colourSlug':'blue','status':'active','price':2000,'priceMode':'override','sizes':['M'],'stock':4,'sizeInventory':[{'size':'M','stock':4}],'images':[]}]})
    db.collections.insert_one({'_id':ObjectId('000000000000000000000003'),'name':'Synthetic Collection','slug':'synthetic','status':'active','productRefs':[{'productId':pid,'displayOrder':1}]})
    nayra_id=ObjectId('000000000000000000000005')
    db.products.insert_one({'_id':nayra_id,'name':'NAYRA Embroidered Saree','productCode':'NK-213','styleCode':'NK-213','sku':'NAYRA-PARENT','price':3000,'status':'active','isActive':True,'availability':'in_stock','media':[], 'attributes':{},
        'variants':[{'id':'nayra-blue','sku':'NAYRA-ROYAL-BLUE','colour':'Royal Blue','colourSlug':'royal-blue','status':'active','price':3000,'priceMode':'inherit','sizes':['S'],'stock':3,'sizeInventory':[{'size':'S','stock':3}],'images':[]}]})
    hastakala_id=ObjectId('000000000000000000000006')
    db.products.insert_one({'_id':hastakala_id,'name':'Hastakala Handwork','productCode':'HK-42','styleCode':'HK-42','sku':'HK-42-PARENT','price':4200,'status':'active','isActive':True,'availability':'in_stock','media':[], 'attributes':{},
        'variants':[{'id':'hastakala-ivory','sku':'HK-42-IVORY','colour':'Ivory','colourSlug':'ivory','status':'active','price':4200,'priceMode':'inherit','sizes':['M'],'stock':2,'sizeInventory':[{'size':'M','stock':2}],'images':[]}]})
    db.collections.insert_many([
        {'_id':ObjectId('000000000000000000000007'),'name':'AAKAAR','slug':'aakaar','status':'active','productRefs':[{'productId':nayra_id},{'productId':nayra_id}]},
        {'_id':ObjectId('000000000000000000000008'),'name':'Hastakala','slug':'hastakala','status':'active','productRefs':[{'productId':hastakala_id}]},
    ])
    now=datetime.now(timezone.utc)
    db.sale_campaigns.insert_one({'_id':ObjectId('000000000000000000000004'),'title':'Considered Sale','slug':'considered-sale','type':'annual','description':'Synthetic campaign description','publication':'published','timezone':'Asia/Kolkata','startsAt':now-timedelta(minutes=1),'endsAt':now+timedelta(hours=1),'revision':1,'createdAt':now,'updatedAt':now,'createdBy':str(user['_id']),
        'items':[{'id':'synthetic-item','productId':str(pid),'variantId':'ivory','discountPercent':20}]})
    return jsonify(token=create_access_token(identity=str(user['_id'])))


@app.post('/__fixture/banner')
def banner_fixture():
    db.sale_campaigns.update_one({'_id':ObjectId('000000000000000000000004')},{'$set':{'bannerVersion':'synthetic', **{key:value for key,value in (request.get_json(silent=True) or {}).items() if key in ('ctaLabel','ctaDestination','timezone','bannerHeading','bannerSubtitle')}}})
    return jsonify(ok=True)


@app.post('/__fixture/aakaar')
def aakaar_fixture():
    from copy import deepcopy
    prototype=db.products.find_one({'_id':ObjectId('000000000000000000000002')})
    refs=[]
    for index,name in enumerate(['CK02','CK05','T0','AURELIA','T2']):
        product=deepcopy(prototype)
        product.update(_id=ObjectId(),name=name,sku='T1' if name=='AURELIA' else name,status='active' if name=='AURELIA' else 'draft',price=188004 if name=='AURELIA' else 1500)
        product['variants']=[{**product['variants'][0],'id':'aurelia-blue','sku':name+'-BLUE','price':product['price'],'colour':'BLUE'}]
        db.products.insert_one(product)
        refs.append({'productId':str(product['_id']),'displayOrder':index})
    refs.append(dict(refs[3]))
    db.collections.update_one({'slug':'aakaar'},{'$set':{'productRefs':refs}})
    return jsonify(ok=True)


@app.get('/__fixture/admin-aakaar')
def admin_aakaar():
    from app.blueprints.staff.routes import _management_collection_payload
    collection=db.collections.find_one({'slug':'aakaar'})
    with patch('app.blueprints.staff.routes.managed_collections',return_value=[collection]):
        return jsonify(_management_collection_payload(db,collection))


@app.post('/__fixture/product-admin')
def product_admin_fixture():
    product=db.products.find_one({'_id':ObjectId('000000000000000000000002')})
    product.update(status='draft',stock=6,media=['/synthetic-product.jpg'])
    options=request.get_json(silent=True) or {}
    if options.get('thirdColour'):
        from copy import deepcopy
        third=deepcopy(product['variants'][0]);third.update(id='powder',sku='RK-SYN-POWDER',colour='Powder Blue');product['variants'].append(third)
    for variant in product['variants']:
        variant.update(stock=0,sizes=['XS','S','M','L','XL'],sizeInventory=[dict(size=size,stock=0,enabled=True) for size in ['XS','S','M','L','XL']])
    if options.get('nonstandard'):
        product['variants'][-1].update(sizes=['M','XXL'],sizeInventory=[dict(size=size,stock=0,enabled=True) for size in ['M','XXL']])
    db.products.replace_one({'_id':product['_id']},product)
    return jsonify(ok=True)


@app.post('/__fixture/announcement')
def announcement_fixture():
    options=request.get_json(silent=True) or {}
    now=datetime.now(timezone.utc)
    mode=options.get('mode','upcoming')
    start=now+timedelta(seconds=options.get('seconds',120)) if mode!='live' else now-timedelta(seconds=10)
    image=BytesIO();Image.new('RGB',(800,240),'ivory').save(image,'JPEG')
    updates=dict(title='Festive Edit',slug='festive-edit',publication='published',startsAt=start,endsAt=start+timedelta(seconds=options.get('duration',3600)),
                 showAnnouncementRunner=True,announcementFeatured=True,announcementStartsAt=now-timedelta(minutes=1),bannerData=image.getvalue(),bannerVersion='synthetic-announcement',bannerSubtitle='A considered festive collection')
    if mode=='before':updates['announcementStartsAt']=now+timedelta(seconds=60)
    if mode=='paused':updates['publication']='paused'
    if mode=='archived':updates['publication']='archived'
    if mode=='announcement-disabled':updates['showAnnouncementRunner']=False
    if mode=='expired':updates.update(startsAt=now-timedelta(hours=2),endsAt=now-timedelta(hours=1))
    db.sale_campaigns.update_one({'_id':ObjectId('000000000000000000000004')},{'$set':updates})
    if mode=='none':db.sale_campaigns.delete_many({})
    if mode=='disabled':db.admin_settings.update_one({'_id':'store'},{'$set':{'salePageEnabled':False}})
    return jsonify(ok=True)


@app.post('/__fixture/expire')
def expire():
    db.sale_campaigns.update_many({}, {'$set':{'endsAt':datetime.now(timezone.utc)-timedelta(seconds=1)}})
    return jsonify(ok=True)


@app.post('/__fixture/ending')
def ending():
    db.sale_campaigns.update_many({}, {'$set':{'endsAt':datetime.now(timezone.utc)+timedelta(seconds=5)}})
    return jsonify(ok=True)


@app.get('/api/auth/me')
def me():
    return jsonify(user={**{k:v for k,v in user.items() if k!='_id'},'id':str(user['_id']),'must_change_password':False})


@app.get('/api/storefront-settings')
def settings():
    return jsonify(settings={'razorpayEnabled':False,'whatsappNumber':''})


@app.get('/api/auth/addresses')
def addresses(): return jsonify(addresses=[])


@app.route('/api/analytics/events', methods=['GET','POST'])
def analytics(): return jsonify(ok=True)


if __name__=='__main__':
    with app.test_request_context('/__fixture/reset', method='POST', json={}): reset()
    # Synthetic-only, loopback, no debugger or reloader.
    app.run(host='127.0.0.1',port=5165,debug=False,use_reloader=False)
