"""Synthetic lifecycle and audited size allocation; external providers unused."""
from copy import deepcopy
from unittest.mock import patch
import pytest
from bson import ObjectId
from test_manual_checkout import shop
from app.blueprints.staff.routes import staff_bp, _document_view
from app.product_administration import inventory_revision, save_allocation, prepare_allocation
from app.sales import sales_bp


@pytest.fixture
def admin_shop(shop):
    db, client, user, product, headers, *_ = shop
    client.application.register_blueprint(staff_bp, url_prefix='/api/staff')
    client.application.register_blueprint(sales_bp, url_prefix='/api/sales')
    product.update(status='draft', stock=6, media=['https://example.test/product.jpg'])
    product['variants'][0].update(stock=0, sizes=['XS','S','M','L','XL'], sizeInventory=[dict(size=s,stock=0,enabled=True) for s in ['XS','S','M','L','XL']])
    db.products.replace_one({'_id':product['_id']},product)
    db.collections.insert_one(dict(_id=ObjectId(),slug='aakaar',name='AAKAAR',productRefs=[dict(productId=product['_id'])]))
    with patch('app.blueprints.staff.routes.database',return_value=db), patch('app.blueprints.staff.routes.current_user',return_value=user), patch('app.sales.database',return_value=db):
        yield shop


def allocate(product, quantities=(0,1,2,2,1)):
    return dict(inventoryRevision=inventory_revision(product),reason='Synthetic count allocation',buckets=[
        dict(variantId=v['id'],sku=v['sku'],size=s['size'],quantity=q)
        for v in product['variants'] for s,q in zip(v['sizeInventory'],quantities)])


def test_lifecycle_explicit_activation_preserves_inventory_and_membership(admin_shop):
    db,client,user,product,headers,*_=admin_shop
    url=f"/api/staff/products/{product['_id']}/lifecycle"
    before=list(db.collections.find({}))
    assert client.get('/api/sales/products',headers=headers).json['products']==[]
    response=client.patch(url,headers=headers,json={'status':'active'})
    assert response.status_code==200,response.json
    saved=db.products.find_one({'_id':product['_id']})
    assert saved['status']=='active' and saved['stock']==6 and saved['variants']==product['variants']
    assert list(db.collections.find({}))==before
    assert client.get('/api/sales/products',headers=headers).json['products'][0]['id']==str(product['_id'])
    assert client.patch(url,headers=headers,json={'status':'draft'}).status_code==200
    assert db.products.find_one({'_id':product['_id']})['lifecycleHistory'][-1]['after']=='draft'


def test_activation_requires_publication_information_and_media(admin_shop):
    db,client,_,product,headers,*_=admin_shop
    db.products.update_one({'_id':product['_id']},{'$set':{'media':[],'price':0}})
    response=client.patch(f"/api/staff/products/{product['_id']}/lifecycle",headers=headers,json={'status':'active'})
    assert response.status_code==400 and 'MRP' in response.json['error'] and 'image' in response.json['error']


def test_active_custom_order_with_zero_physical_stock_remains_sale_eligible(admin_shop):
    db,client,_,product,headers,*_=admin_shop
    db.products.update_one({'_id':product['_id']},{'$set':{'status':'active','availability':'custom_order','stock':0}})
    rows=client.get('/api/sales/products',headers=headers).json['products']
    assert [row['id'] for row in rows]==[str(product['_id'])]


def test_lifecycle_and_inventory_permissions_are_independent(admin_shop):
    _,client,user,product,headers,*_=admin_shop
    user.update(role='staff',permissions=['inventory:manage'])
    assert client.patch(f"/api/staff/products/{product['_id']}/lifecycle",headers=headers,json={'status':'active'}).status_code==403
    user['permissions']=['products:manage']
    assert client.patch(f"/api/staff/products/{product['_id']}/stock-allocation",headers=headers,json=allocate(product)).status_code==403


def test_allocate_six_units_persists_audit_and_never_activates(admin_shop):
    db,client,_,product,headers,*_=admin_shop
    db.inventory_adjustments.insert_one({'productId':product['_id'],'reason':'Earlier stock history'})
    response=client.patch(f"/api/staff/products/{product['_id']}/stock-allocation",headers=headers,json=allocate(product))
    assert response.status_code==200,response.json
    saved=db.products.find_one({'_id':product['_id']})
    assert saved['stock']==sum(s['stock'] for s in saved['variants'][0]['sizeInventory'])==6
    assert saved['variants'][0]['stock']==6 and saved['unallocatedStock']==0
    assert saved['status']=='draft' and saved['inventoryAllocationMode']=='variant_size'
    assert saved['inventoryAllocationHistory'][0]['before']['stock']==6
    assert db.inventory_adjustments.count_documents({'productId':product['_id']})==1
    view=_document_view(saved,'products')
    assert view['inventoryRevision']==inventory_revision(saved)
    assert view['variants'][0]['sizeInventory'][2]['stock']==2
    # Legacy endpoint cannot overwrite a size-managed total.
    assert client.patch(f"/api/staff/resources/inventory/{product['_id']}",headers=headers,json={'adjustment':2,'reason':'bad path'}).status_code==400


@pytest.mark.parametrize('kind',['negative','fraction','duplicate','wrong-sku','missing','wrong-total','no-reason','stale'])
def test_invalid_allocation_fails_without_writes(admin_shop,kind):
    db,client,_,product,headers,*_=admin_shop
    payload=allocate(product)
    if kind=='negative':payload['buckets'][0]['quantity']=-1
    if kind=='fraction':payload['buckets'][0]['quantity']=0.5
    if kind=='duplicate':payload['buckets'].append(payload['buckets'][0])
    if kind=='wrong-sku':payload['buckets'][0]['sku']='wrong'
    if kind=='missing':payload['buckets'].pop()
    if kind=='wrong-total':payload['buckets'][0]['quantity']=99
    if kind=='no-reason':payload['reason']=''
    if kind=='stale':payload['inventoryRevision']='stale'
    before=db.products.find_one({'_id':product['_id']})
    response=client.patch(f"/api/staff/products/{product['_id']}/stock-allocation",headers=headers,json=payload)
    assert response.status_code==(409 if kind=='stale' else 400)
    assert db.products.find_one({'_id':product['_id']})==before


def test_colours_have_independent_buckets_and_stale_writer_cannot_overwrite(admin_shop):
    db,_,user,product,*_=admin_shop
    red=deepcopy(product['variants'][0]);red.update(id='colour:red',sku='PARENT-RED',colour='RED')
    product['variants'].append(red);db.products.replace_one({'_id':product['_id']},product)
    payload=allocate(product,(0,0,1,1,1))
    saved=save_allocation(db,product,payload,user)
    assert saved['stock']==6 and [v['stock'] for v in saved['variants']]==[3,3]
    with pytest.raises(RuntimeError,match='concurrently'):save_allocation(db,product,payload,user)
    assert len(db.products.find_one({'_id':product['_id']})['inventoryAllocationHistory'])==1


def test_parent_sizes_and_aggregate_products_keep_their_modes(admin_shop):
    db,client,_,product,headers,*_=admin_shop
    product.pop('variants');product['attributes']={'sizes':['XS','XXL','CUSTOM']}
    db.products.replace_one({'_id':product['_id']},product)
    payload=dict(inventoryRevision=inventory_revision(product),reason='Allocate parent',buckets=[dict(variantId='',sku=product['sku'],size=s,quantity=2) for s in product['attributes']['sizes']])
    assert client.patch(f"/api/staff/products/{product['_id']}/stock-allocation",headers=headers,json=payload).status_code==200
    saved=db.products.find_one({'_id':product['_id']});assert saved['stock']==6 and [s['size'] for s in saved['sizeInventory']]==['XS','XXL','CUSTOM']
    assert saved['sizeInventoryConfigured'] is True
    product.pop('attributes');db.products.replace_one({'_id':product['_id']},product)
    assert _document_view(product,'products')['inventoryBuckets']==[]
    assert client.patch(f"/api/staff/resources/inventory/{product['_id']}",headers=headers,json={'adjustment':1,'reason':'Legacy count'}).status_code==200
    assert db.products.find_one({'_id':product['_id']})['stock']==7


def test_allocated_totals_follow_capture_and_compensation_without_double_counting(admin_shop):
    from datetime import datetime, timezone
    from app.blueprints.payments.routes import _decrement_tracked_variant_inventory
    from app.inventory_operations import compensate_capture_markers, capture_operation_id
    db,_,user,product,*_=admin_shop
    saved=save_allocation(db,product,allocate(product),user)
    order_id=ObjectId()
    op=dict(operationId=capture_operation_id(order_id,'capture-synthetic',0),orderId=str(order_id),captureId='capture-synthetic',itemIndex=0,quantity=1,operationType='capture_deduction',claimToken='synthetic-claim',productId=str(product['_id']))
    db.orders.insert_one(dict(_id=order_id,captureClaimToken=op['claimToken'],razorpayPaymentId=op['captureId'],items=[dict(productId=str(product['_id']),quantity=1,variantId=saved['variants'][0]['id'],size='M')]))
    db.inventory_operations.insert_one({'_id':op['operationId'],**op,'state':'applied'})
    assert _decrement_tracked_variant_inventory(db,saved,saved['variants'][0],'M',1,datetime.now(timezone.utc),op)
    assert _decrement_tracked_variant_inventory(db,saved,saved['variants'][0],'M',1,datetime.now(timezone.utc),op)
    after=db.products.find_one({'_id':product['_id']})
    assert after['stock']==after['variants'][0]['stock']==5
    compensate_capture_markers(db,order_id,op['claimToken'])
    compensated=db.products.find_one({'_id':product['_id']})
    assert compensated['stock']==compensated['variants'][0]['stock']==6
    assert compensated['variants'][0]['sizeInventory'][2]['stock']==2


def test_allocated_totals_follow_manual_reservation(admin_shop):
    from app.manual_inventory import change_reservation
    db,_,user,product,*_=admin_shop
    saved=save_allocation(db,product,allocate(product),user)
    item=dict(productId=str(product['_id']),variantId=saved['variants'][0]['id'],sku=saved['variants'][0]['sku'],size='M',quantity=1)
    order={'_id':ObjectId()}
    assert change_reservation(db,order,item,0,claim_token='synthetic-reservation') is True
    assert change_reservation(db,order,item,0,claim_token='synthetic-reservation') is False
    after=db.products.find_one({'_id':product['_id']})
    assert after['stock']==after['variants'][0]['stock']==5
    with pytest.raises(RuntimeError):save_allocation(db,saved,allocate(saved),user)


def test_unresolved_inventory_blocks_staff_allocation(admin_shop):
    db,client,_,product,headers,*_=admin_shop
    db.orders.insert_one(dict(items=[dict(productId=str(product['_id']))],captureFulfillmentStatus='held'))
    response=client.patch(f"/api/staff/products/{product['_id']}/stock-allocation",headers=headers,json=allocate(product))
    assert response.status_code==409 and 'unresolved inventory' in response.json['error']
    assert 'inventoryAllocationMode' not in db.products.find_one({'_id':product['_id']})


def test_duplicate_sku_size_across_colours_is_rejected(admin_shop):
    db,_,user,product,*_=admin_shop
    other=deepcopy(product['variants'][0]);other['id']='different-colour'
    product['variants'].append(other);db.products.replace_one({'_id':product['_id']},product)
    with pytest.raises(ValueError,match='Duplicate SKU/size'):
        save_allocation(db,product,allocate(product,(0,0,1,1,1)),user)
