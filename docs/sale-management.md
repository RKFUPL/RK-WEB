# Sale Management

## Administration

Administrators use **Sale Management** at `/admin/sales`. Staff use `/staff/sales` after an administrator explicitly grants `sales:manage` in Staff & access. Existing staff without an explicit permission do not inherit this new permission. The backend enforces access for campaign, selection and media operations. The global storefront visibility switch remains administrator-only and defaults off.

Create a campaign, enter its title/type, optional custom type, description and banner copy, start/end dates and IANA time zone. The default zone is Asia/Kolkata. Local wall times are converted to UTC on the backend. Invalid ranges and ambiguous/nonexistent daylight-saving wall times are rejected. The generated slug is stable and includes a unique campaign identity. Save the draft before adding items or a banner.

Use **+ Add item to sale**, select a collection, and search by product name, product code, parent or variant SKU. Add an exact active colour/SKU, or explicitly choose all currently eligible variants. Each assignment has its own discount. The editor previews the result for each variant MRP. Save sale items, then publish. Pause or archive keeps assignments and original MRP intact. Live item removal requires confirmation. Concurrent campaign saves use a revision compare-and-set and return a reload conflict rather than overwriting newer edits.

The dashboard derives draft/scheduled/live/paused/expired/archived state from publication and UTC time. Summary and visibility data use eligible products; the screen refreshes without replacing the open draft. Changing a discount, target or schedule requires saving. Banner upload is immediate; its read-back preserves unrelated unsaved form edits. Banner replacement/removal also require the editor's current revision and use an atomic compare-and-set, so a stale banner action cannot advance past an unseen campaign edit.

## Durable targeting and price authority

`sale_campaigns` holds canonical relationships to product ObjectIds and exact persisted variant IDs/SKUs, plus server-owned item identities. Product-wide assignments explicitly snapshot the currently eligible variant IDs/SKUs. A newly added colour or changed SKU is not silently covered: review and save the assignment to include it. Removed/inactive variants, archived/inactive products, invalid MRP, and missing/mismatched target evidence cannot receive a discount.

`effective_catalog_price()` is the single INR price resolver. It leaves `product.price` and `variant.price` untouched, honours variant `priceMode`, checks the visibility switch, publication, schedule and current eligibility, and returns MRP, effective price, sale price, percentage and campaign evidence. Decimal arithmetic uses two-place half-up rounding. A discount must be finite and strictly between 0 and 100, and the result must be positive.

Overlaps are intentionally supported through a deterministic priority rule: the lowest effective INR price wins for the exact variant. Equal prices use the lexicographically lowest campaign ID. Discounts never compound. Different variants retain their own MRP and targeting. This permits concurrent campaigns without a cross-document reservation/locking requirement.

Public collection, shop/search, product and runway serializers use the resolver; admin product editors retain base MRP. Price-bearing catalogue responses disable shared caching. Collection navigation shares in-flight requests only, so a completed discounted response cannot be reused after a campaign changes. Display currency conversion happens after the INR discount through the existing currency provider.

## Visibility and expiry

`/sale` and `/sale/[slug]` are dynamic Next routes. Their server fetch uses `BACKEND_INTERNAL_URL` (the existing production Compose backend address) and no cache. Disabled visibility, no live campaign, or no eligible items returns Next's normal 404. Provider/API failures remain errors rather than pretending that a sale exists. Only eligible campaign banners/products are public. SALE navigation starts hidden and uses read-only public evidence; it refreshes periodically and at observed campaign deadlines.

Prices expire on every backend request without a worker or cron. Existing open views use the server observation and elapsed time to remove expired indicators and refresh. Cart price refresh uses `/api/sales/prices` at entry, periodically, and at sale deadlines; it updates prices on the latest bag while preserving concurrent quantity/size edits. A network failure cannot authorize a discounted checkout. Publication/pause changes propagate to an already open navigation/cart view on its next refresh (normally within 30 seconds); authoritative checkout resolution is immediate on each request.

## Checkout and financial snapshots

The browser sends its displayed unit price only as `quotedUnitPrice`, for comparison. Checkout independently resolves MRP and the current effective price from persisted product/variant/campaign data. Arbitrary client MRP, sale price or discount values cannot determine an order amount. A changed quote returns `409 price_changed` and authoritative prices before creating an order/provider payment. The customer reviews the updated bag and submits again.

Saved order items contain original `mrp`, actual `unitPrice`, quantity, line total and a `sale` snapshot with percentage, campaign ID/name, item identity and observed end time. Existing orders are never repriced when a campaign ends. Razorpay initiation uses the saved order amount, and email, payment/refund calculations continue to use saved order values. Capture inventory revalidation compares the saved base MRP/identity; campaign expiry cannot turn a correctly priced saved sale order into an inventory price mismatch. Existing stock, claim, consent and notification gates remain in their original paths.

## Banners

Upload JPG/PNG/WebP up to 5 MB or submit an approved WorkDrive link. WorkDrive uses the existing backend integration and access checks. The backend downloads with a bounded stream, validates actual image bytes and dimensions, resizes and re-encodes JPEG without private metadata. It stores the verified banner in the campaign document, with a versioned public proxy and an authenticated draft preview. Replacement/removal does not modify product media or expose provider tokens/private links. Public access requires a currently eligible live campaign. No inaccessible or invalid file is saved as successful media.

## Local verification

All fixtures are synthetic. The browser fixture uses MongoMock, blocks external HTTP/SMTP, mocks email transports, and never creates a real MongoDB connection or calls Meta/Razorpay. It requires `RK_SALE_BROWSER_FIXTURE=1`, set only by its Playwright configuration. It is not an application seed or deployment entry point.

```powershell
cd backend
python -m pytest tests/test_sales.py tests/test_catalog.py tests/test_product_variants.py tests/test_rbac.py -q
python -m pytest -q
cd ../frontend
npm test
npm run typecheck
npm run build
npx playwright test --config playwright.sales.config.ts
npx playwright test product-detail.spec.ts manual-payments.spec.ts whatsapp-ui.spec.ts --workers=1
cd ..
python -m compileall -q backend/app backend/tests/test_sales.py backend/tests/sale_browser_server.py
git diff --check
```

Use an isolated frontend copy/build when a development server is already using `.next`. Copy source without `.env*`, keep the existing font at the same relative parent path, and use the existing dependencies. The sale browser configuration starts a loopback synthetic Flask server at 5165 and Next at 3212; browser API calls are forwarded only to that fixture. The standard browser suite uses its existing 3210 port and mocked APIs.

Limits: campaign item arrays are capped at 500; banner input at 5 MB / 30 megapixels. Catalogue queries are not a new search index or analytics system. Production WorkDrive permissions, real payment/refund provider behaviour, production MongoDB concurrency and deployment are not established by these local mocked tests. No campaigns or permissions are seeded into a real application database.

The product picker uses `catalog.collection_product_documents`, also used by the Admin collection payload. It resolves dictionary `productId` references in ObjectId or valid string form, preserves display order, and deduplicates canonical identities without a database write. Malformed and dangling references do not become products. It does not infer membership from names.

The picker response distinguishes `totalCount` (resolved products before search), `eligibleCount` (eligible products before search), matching eligible `products`, and matching `excludedProducts` with reasons. Admin collection visibility is broader than Sale eligibility: a non-archived draft can appear in Product Management but cannot be assigned to a sale. Active status, variant identity/SKU and valid MRP requirements remain enforced on saves and pricing. Existing collection records are never relabelled or activated by the picker.

The AAKAAR regression uses the actual Admin payload builder and shared resolver with five synthetic products (CK02, CK05, T0, AURELIA and T2), mixed string/ObjectId references, duplicates and malformed references. It verifies identity parity, exclusions and an active AURELIA at INR 188004. This fixture is not evidence of actual database contents. A later user-authorized read-only test-database inspection confirmed AURELIA is Draft and the actual test collection has zero sale-eligible products; see `product-lifecycle-size-allocation.md` for the identities and evidence limits.
