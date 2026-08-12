from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any


PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90}


def period_window(period: str, now: datetime | None = None) -> tuple[str, datetime, datetime]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    selected = period if period in PERIOD_DAYS else "7d"
    start = current - timedelta(days=PERIOD_DAYS[selected] - 1)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    return selected, start, current


def as_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def number(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return 0.0
    return 0.0


def order_total(order: dict) -> float:
    totals = order.get("totals") if isinstance(order.get("totals"), dict) else {}
    for value in (order.get("total"), order.get("totalAmount"), order.get("grandTotal"), totals.get("total")):
        if value is not None:
            return max(0.0, number(value))
    return 0.0


def serialise_datetime(value: object) -> str | None:
    parsed = as_datetime(value)
    return parsed.isoformat().replace("+00:00", "Z") if parsed else None


def build_dashboard(database, period: str, now: datetime | None = None, current_visitor_id: str = "") -> dict[str, Any]:
    selected, start, current = period_window(period, now)
    date_query = {"createdAt": {"$gte": start, "$lte": current}}
    internal_user_ids = [
        user["_id"]
        for user in database.users.find({"role": {"$in": ["admin", "staff"]}}, {"_id": 1})
    ]
    public_event_query: dict[str, Any] = {**date_query, "userId": {"$nin": internal_user_ids}}
    if current_visitor_id:
        # The analytics visitor id predates authentication and survives login.
        # Exclude the dashboard viewer's entire browser identity so anonymous
        # events created before an admin/staff login cannot appear as a current
        # storefront visitor.
        public_event_query["visitorId"] = {"$ne": current_visitor_id}

    events = list(database.analytics_events.find(public_event_query, {
        "event": 1, "visitorId": 1, "sessionId": 1, "path": 1,
        "source": 1, "properties": 1, "customerName": 1, "createdAt": 1,
    }).sort("createdAt", -1).limit(20))
    page_view_query = {**public_event_query, "event": "page_view"}
    visitor_ids = database.analytics_events.distinct("visitorId", page_view_query)
    page_view_count = database.analytics_events.count_documents(page_view_query)
    wishlist_adds = database.analytics_events.count_documents({**public_event_query, "event": "wishlist_add"})

    order_query = {**date_query, "status": {"$nin": ["cancelled", "canceled", "refunded"]}}
    order_count = 0
    revenue = 0.0
    settings = database.admin_settings.find_one({"_id": "store"}) or {}
    low_stock_threshold = max(0, int(number(settings.get("lowStockThreshold", 5))))
    low_stock_query = {
        "isActive": {"$ne": False},
        "$or": [
            {"stock": {"$lte": low_stock_threshold}},
            {"inventory": {"$lte": low_stock_threshold}},
            {"inventory.quantity": {"$lte": low_stock_threshold}},
        ],
    }
    low_stock = database.products.count_documents(low_stock_query)
    new_customers = database.users.count_documents({**date_query, "$or": [{"role": "customer"}, {"role": {"$exists": False}}]})
    new_customer_rows = database.users.find(
        {**date_query, "$or": [{"role": "customer"}, {"role": {"$exists": False}}]},
        {"displayName": 1, "firstName": 1, "lastName": 1, "email": 1, "username": 1, "createdAt": 1},
    ).sort("createdAt", -1).limit(20)
    new_customers_list = []
    for customer in new_customer_rows:
        name = str(" ".join(filter(None, (customer.get("firstName"), customer.get("lastName")))) or customer.get("displayName") or "Unnamed customer")
        new_customers_list.append({
            "id": str(customer.get("_id")),
            "name": name,
            "email": str(customer.get("email") or ""),
            "username": str(customer.get("username") or ""),
            "createdAt": serialise_datetime(customer.get("createdAt")),
        })

    review_values = [number(review.get("rating")) for review in database.reviews.find(date_query, {"rating": 1})]
    review_values = [rating for rating in review_values if 0 < rating <= 5]
    average_rating = sum(review_values) / len(review_values) if review_values else 0.0

    sales_by_day: dict[str, dict[str, float]] = defaultdict(lambda: {"orders": 0, "revenue": 0.0})
    product_sales: dict[str, dict[str, Any]] = {}
    for order in database.orders.find(order_query):
        order_count += 1
        total = order_total(order)
        revenue += total
        created_at = as_datetime(order.get("createdAt"))
        if created_at:
            key = created_at.date().isoformat()
            sales_by_day[key]["orders"] += 1
            sales_by_day[key]["revenue"] += total
        items = order.get("items") if isinstance(order.get("items"), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            product_id = str(item.get("productId") or item.get("sku") or item.get("name") or "Unknown")
            entry = product_sales.setdefault(product_id, {
                "id": product_id,
                "name": str(item.get("name") or item.get("productName") or product_id),
                "units": 0,
                "revenue": 0.0,
            })
            quantity = max(1, int(number(item.get("quantity") or 1)))
            entry["units"] += quantity
            entry["revenue"] += number(item.get("price")) * quantity

    conversion = (order_count / len(visitor_ids) * 100) if visitor_ids else 0.0

    sales = []
    cursor = start
    while cursor.date() <= current.date():
        key = cursor.date().isoformat()
        values = sales_by_day[key]
        sales.append({"date": key, "orders": int(values["orders"]), "revenue": round(values["revenue"], 2)})
        cursor += timedelta(days=1)

    traffic_rows = database.analytics_events.aggregate([
        {"$match": page_view_query},
        {"$group": {"_id": {"source": {"$ifNull": ["$source", "direct"]}, "visitorId": "$visitorId"}, "views": {"$sum": 1}}},
        {"$group": {"_id": "$_id.source", "visitors": {"$sum": 1}, "views": {"$sum": "$views"}}},
        {"$sort": {"visitors": -1}},
    ])
    traffic = [{"source": str(row.get("_id") or "direct"), "visitors": int(row.get("visitors", 0)), "views": int(row.get("views", 0))} for row in traffic_rows]

    visitor_rows = database.analytics_events.aggregate([
        {"$match": page_view_query},
        {"$sort": {"createdAt": -1}},
        {"$group": {
            "_id": "$visitorId",
            "lastSeen": {"$first": "$createdAt"},
            "firstSeen": {"$last": "$createdAt"},
            "lastPath": {"$first": "$path"},
            "source": {"$first": {"$ifNull": ["$source", "direct"]}},
            "customerName": {"$max": {"$ifNull": ["$customerName", ""]}},
            "userId": {"$max": {"$ifNull": ["$userId", ""]}},
            "device": {"$first": {"$ifNull": ["$device", "desktop"]}},
            "browser": {"$first": {"$ifNull": ["$browser", "Other"]}},
            "os": {"$first": {"$ifNull": ["$os", "Other"]}},
            "views": {"$sum": 1},
            "sessions": {"$addToSet": "$sessionId"},
            "pages": {"$addToSet": "$path"},
        }},
        {"$sort": {"lastSeen": -1}},
        {"$limit": 20},
    ])
    active_cutoff = current - timedelta(minutes=5)
    active_visitor_query: dict[str, Any] = {
        "event": "page_view",
        "createdAt": {"$gte": active_cutoff, "$lte": current},
        "userId": {"$nin": internal_user_ids},
    }
    if current_visitor_id:
        active_visitor_query["visitorId"] = {"$ne": current_visitor_id}
    active_visitor_ids = database.analytics_events.distinct("visitorId", active_visitor_query)
    visitors = []
    for index, visitor in enumerate(visitor_rows, start=1):
        last_seen = as_datetime(visitor.get("lastSeen"))
        visitor_id = str(visitor.get("_id") or "")
        customer_name = str(visitor.get("customerName") or "").strip()
        is_customer = bool(visitor.get("userId") or customer_name)
        visitors.append({
            "label": customer_name or f"Visitor {index}",
            "kind": "customer" if is_customer else "visitor",
            "customerName": customer_name or None,
            "key": visitor_id[-6:] if visitor_id else "unknown",
            "source": str(visitor.get("source") or "direct"),
            "device": str(visitor.get("device") or "desktop"),
            "browser": str(visitor.get("browser") or "Other"),
            "os": str(visitor.get("os") or "Other"),
            "lastPath": str(visitor.get("lastPath") or "/"),
            "views": int(visitor.get("views", 0)),
            "sessions": len(visitor.get("sessions") or []),
            "pages": len(visitor.get("pages") or []),
            "firstSeen": serialise_datetime(visitor.get("firstSeen")),
            "lastSeen": serialise_datetime(visitor.get("lastSeen")),
            "active": bool(last_seen and last_seen >= active_cutoff),
            "current": False,
        })

    activity = []
    for order in database.orders.find(order_query).sort("createdAt", -1).limit(6):
        activity.append({
            "id": str(order.get("_id")),
            "type": "order",
            "label": "Order received",
            "detail": str(order.get("orderNumber") or order.get("number") or order.get("_id")),
            "createdAt": serialise_datetime(order.get("createdAt")),
        })
    event_labels = {
        "page_view": "Page viewed",
        "product_view": "Product viewed",
        "wishlist_add": "Wishlist addition",
        "add_to_bag": "Added to bag",
        "checkout_started": "Checkout started",
    }
    for event in events[:12]:
        activity.append({
            "id": str(event.get("_id")),
            "type": str(event.get("event") or "event"),
            "label": event_labels.get(str(event.get("event")), "Store activity"),
            "detail": str((event.get("properties") or {}).get("productName") or event.get("path") or "Storefront"),
            "createdAt": serialise_datetime(event.get("createdAt")),
        })
    activity.sort(key=lambda entry: entry.get("createdAt") or "", reverse=True)

    return {
        "period": selected,
        "generatedAt": current.isoformat().replace("+00:00", "Z"),
        "currency": "INR",
        "metrics": {
            "revenue": round(revenue, 2),
            "orders": order_count,
            "visitors": len(visitor_ids),
            "pageViews": page_view_count,
            "activeVisitors": len(active_visitor_ids),
            "conversionRate": round(conversion, 2),
            "lowStock": low_stock,
            "newCustomers": new_customers,
            "wishlistAdds": wishlist_adds,
            "averageRating": round(average_rating, 2),
        },
        "sales": sales,
        "trafficSources": traffic,
        "visitorsList": visitors,
        "newCustomersList": new_customers_list,
        "bestSellingProducts": sorted(product_sales.values(), key=lambda entry: entry["units"], reverse=True)[:5],
        "activity": activity[:10],
    }
