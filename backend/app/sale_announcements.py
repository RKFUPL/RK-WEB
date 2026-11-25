"""Public campaign announcements contain no pre-launch product or price data."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .time_utils import json_value


def announcement_message(campaign, now):
    from .sales import aware
    start = aware(campaign['startsAt'])
    if now >= start:
        return f"{campaign['title']} · LIVE NOW · EXPLORE THE SALE"
    days = (start.astimezone(ZoneInfo(campaign.get('timezone') or 'Asia/Kolkata')).date()
            - now.astimezone(ZoneInfo(campaign.get('timezone') or 'Asia/Kolkata')).date()).days
    suffix = 'STARTS TODAY' if days == 0 else 'STARTS TOMORROW' if days == 1 else f'{days} DAYS TO GO'
    return f"{campaign['title']} · {suffix}"


def valid_schedule(campaign, now):
    from .sales import aware
    try:
        ZoneInfo(campaign.get('timezone') or 'Asia/Kolkata')
        return (campaign.get('publication') == 'published' and bool(campaign.get('title'))
                and bool(campaign.get('slug')) and isinstance(campaign.get('startsAt'), datetime)
                and isinstance(campaign.get('endsAt'), datetime)
                and aware(campaign['startsAt']) < aware(campaign['endsAt']) and now < aware(campaign['endsAt']))
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return False


def prelaunch_eligible(campaign, now):
    from .sales import aware
    has_media = bool(campaign.get('bannerMediaUrl') or campaign.get('bannerUrl') or
                     (campaign.get('bannerVersion') and isinstance(campaign.get('bannerData'), bytes) and campaign.get('bannerData')))
    return (valid_schedule(campaign, now) and campaign.get('showAnnouncementRunner') is True
            and isinstance(campaign.get('announcementStartsAt'), datetime)
            and aware(campaign['announcementStartsAt']) <= now < aware(campaign['startsAt'])
            and has_media)


def safe_campaign(campaign, now):
    from .sales import aware
    return dict(id=str(campaign['_id']), title=campaign['title'], slug=campaign['slug'],
                subtitle=campaign.get('bannerSubtitle') or campaign.get('description') or '',
                startsAt=json_value(aware(campaign['startsAt'])), endsAt=json_value(aware(campaign['endsAt'])),
                timezone=campaign.get('timezone') or 'Asia/Kolkata', message=announcement_message(campaign, now),
                bannerUrl=campaign.get('bannerMediaUrl') or campaign.get('bannerUrl') or f"/api/sales/{campaign['_id']}/banner?v={campaign.get('bannerVersion', '')}",
                bannerMediaType=campaign.get('bannerMediaType') or 'image',
                bannerPosterUrl=campaign.get('bannerPosterUrl'))


def public_announcement(db, now):
    from .sales import aware, public_inventory
    enabled = (db.admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is True
    live, _, _ = public_inventory(db, now=now) if enabled else ([], [], now)
    live_ids = {c['id'] for c in live}
    candidates, changes = [], []
    if enabled:
        for campaign in db.sale_campaigns.find({'publication': 'published'}):
            if not valid_schedule(campaign, now): continue
            for key in ('startsAt', 'endsAt', 'announcementStartsAt'):
                value = campaign.get(key)
                if isinstance(value, datetime) and aware(value) > now: changes.append(aware(value))
            if campaign.get('showAnnouncementRunner') is not True: continue
            start = aware(campaign['startsAt'])
            is_live = str(campaign['_id']) in live_ids
            if not is_live and not prelaunch_eligible(campaign, now): continue
            if is_live and (not isinstance(campaign.get('announcementStartsAt'), datetime) or aware(campaign['announcementStartsAt']) > now): continue
            # Featured campaigns take precedence, then live vs upcoming, launch time, ID.
            candidates.append(((not campaign.get('announcementFeatured', False), not is_live, start, str(campaign['_id'])), campaign, is_live))
            zone = ZoneInfo(campaign.get('timezone') or 'Asia/Kolkata')
            tomorrow = datetime.combine(now.astimezone(zone).date() + timedelta(days=1), datetime.min.time(), zone).astimezone(timezone.utc)
            changes.append(tomorrow)
    selected = None
    if candidates:
        _, campaign, is_live = min(candidates, key=lambda row: row[0])
        selected = {**safe_campaign(campaign, now), 'phase': 'live' if is_live else 'upcoming',
                    'href': '/sale' if is_live else f"/sale/preview/{campaign['slug']}"}
    return dict(announcement=selected, liveAvailable=bool(live), serverTime=json_value(now),
                nextChangeAt=json_value(min(changes)) if changes else None)
