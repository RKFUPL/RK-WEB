"""Public announcement clock boundaries; synthetic storage and no providers."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from copy import deepcopy
from io import BytesIO
from PIL import Image
import pytest
from bson import ObjectId
from test_manual_checkout import shop
from test_sales import sale_shop, campaign
from app.sales import validate_campaign
from app.sale_announcements import public_announcement

NOW=datetime(2030,12,10,12,tzinfo=timezone.utc)


def scheduled(db,product,**changes):
    image=BytesIO();Image.new('RGB',(20,10),'ivory').save(image,'JPEG')
    return campaign(db,product,title='Festive Edit',slug='festive-edit',startsAt=datetime(2030,12,14,10,tzinfo=timezone.utc),endsAt=datetime(2030,12,15,10,tzinfo=timezone.utc),
                    showAnnouncementRunner=True,announcementFeatured=True,announcementStartsAt=NOW-timedelta(days=1),bannerData=image.getvalue(),bannerVersion='synthetic',**changes)


def get_at(client,url,now):
    with patch('app.sales.utcnow',return_value=now):return client.get(url)


@pytest.mark.parametrize('now,suffix',[(NOW,'4 DAYS TO GO'),(datetime(2030,12,13,12,tzinfo=timezone.utc),'STARTS TOMORROW'),(datetime(2030,12,13,20,tzinfo=timezone.utc),'STARTS TODAY'),(datetime(2030,12,14,1,tzinfo=timezone.utc),'STARTS TODAY'),(datetime(2030,12,14,10,tzinfo=timezone.utc),'LIVE NOW')])
def test_calendar_day_message_and_exact_launch(sale_shop,now,suffix):
    db,client,_,product,*_=sale_shop;scheduled(db,product)
    response=get_at(client,'/api/sales/announcement',now)
    data=response.json;assert suffix in data['announcement']['message']
    if suffix=='LIVE NOW':
        assert data['announcement']['href']=='/sale' and data['liveAvailable'] is True
    else:
        assert data['announcement']['href']=='/sale/preview/festive-edit' and data['liveAvailable'] is False
        assert get_at(client,'/api/sales/public',now).status_code==404


@pytest.mark.parametrize('change',[{'publication':'paused'},{'publication':'archived'},{'publication':'draft'},{'showAnnouncementRunner':False},{'announcementStartsAt':NOW+timedelta(hours=1)},{'bannerVersion':None},{'bannerData':None}])
def test_ineligible_prelaunch_is_hidden_and_teaser_denied(sale_shop,change):
    db,client,_,product,*_=sale_shop;row=scheduled(db,product)
    db.sale_campaigns.update_one({'_id':row['_id']},{'$set':change})
    assert get_at(client,'/api/sales/announcement',NOW).json['announcement'] is None
    assert get_at(client,'/api/sales/teaser/festive-edit',NOW).status_code==404
    assert get_at(client,f"/api/sales/{row['_id']}/banner",NOW).status_code==404


def test_teaser_exposes_banner_and_schedule_only_then_redirects_and_expires(sale_shop):
    db,client,_,product,*_=sale_shop;row=scheduled(db,product)
    response=get_at(client,'/api/sales/teaser/festive-edit',NOW)
    assert response.status_code==200
    assert set(response.json)=={'campaign','serverTime'}
    assert not {'products','items','variants','discountPercent','price','bannerData'} & set(response.json['campaign'])
    banner=get_at(client,response.json['campaign']['bannerUrl'],NOW)
    assert banner.status_code==200 and banner.mimetype=='image/jpeg'
    assert get_at(client,'/api/sales/teaser/festive-edit',row['startsAt']).json['redirect']=='/sale'
    for url in ['/api/sales/teaser/festive-edit','/api/sales/public']:
        assert get_at(client,url,row['endsAt']).status_code==404
    assert get_at(client,'/api/sales/announcement',row['endsAt']).json['announcement'] is None


def test_global_visibility_disables_runner_teaser_and_banner(sale_shop):
    db,client,_,product,*_=sale_shop;row=scheduled(db,product)
    db.admin_settings.update_one({'_id':'store'},{'$set':{'salePageEnabled':False}})
    assert get_at(client,'/api/sales/announcement',NOW).json['announcement'] is None
    assert get_at(client,'/api/sales/teaser/festive-edit',NOW).status_code==404
    assert get_at(client,f"/api/sales/{row['_id']}/banner",NOW).status_code==404


def test_single_featured_selection_is_deterministic_and_tracks_next_boundary(sale_shop):
    db,client,_,product,*_=sale_shop;upcoming=scheduled(db,product)
    live=deepcopy(upcoming);live.update(_id=ObjectId(),slug='live-featured',title='Live Featured',startsAt=NOW-timedelta(hours=1))
    db.sale_campaigns.insert_one(live)
    state=get_at(client,'/api/sales/announcement',NOW).json
    assert state['announcement']['id']==str(live['_id']) and state['announcement']['phase']=='live'
    db.sale_campaigns.update_one({'_id':live['_id']},{'$set':{'announcementFeatured':False}})
    assert get_at(client,'/api/sales/announcement',NOW).json['announcement']['id']==str(upcoming['_id'])
    twin=deepcopy(upcoming);twin['_id']=ObjectId();twin['slug']='second-upcoming';db.sale_campaigns.insert_one(twin)
    assert get_at(client,'/api/sales/announcement',NOW).json['announcement']['id']==min(str(upcoming['_id']),str(twin['_id']))
    assert state['nextChangeAt'] and state['serverTime']


def test_admin_preview_is_read_only_and_details_keep_items(sale_shop):
    db,client,_,product,headers,*_=sale_shop;row=scheduled(db,product)
    payload={k:v.isoformat() if isinstance(v,datetime) else v for k,v in row.items() if k not in ('_id','bannerData')}
    before=db.sale_campaigns.find_one({'_id':row['_id']})
    with patch('app.sales.utcnow',return_value=NOW):response=client.post('/api/sales/manage/announcement-preview',headers=headers,json=payload)
    assert response.status_code==200 and '4 DAYS TO GO' in response.json['message']
    assert db.sale_campaigns.find_one({'_id':row['_id']})==before
    payload.pop('items');payload['announcementFeatured']=False
    response=client.put(f"/api/sales/manage/{row['_id']}",headers=headers,json=payload)
    assert response.status_code==200 and response.json['campaign']['items']==before['items']


@pytest.mark.parametrize('change',[{'showAnnouncementRunner':'yes'},{'announcementFeatured':1},{'announcementStartsAt':'bad'},{'announcementStartsAt':'2031-01-01T00:00'}])
def test_invalid_announcement_fields_are_rejected(change):
    payload=dict(title='Test',type='annual',startsAt='2030-12-14T10:00',endsAt='2030-12-15T10:00',timezone='Asia/Kolkata',showAnnouncementRunner=True,announcementStartsAt='2030-12-10T10:00')
    with pytest.raises(ValueError):validate_campaign({**payload,**change})
