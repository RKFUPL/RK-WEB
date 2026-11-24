# Checkout phone and Admin Orders changes

Delivery phone uses the existing integrated telephone-country combobox. The address country accepts the supported English country names, ISO codes, and explicit legacy aliases (UK, USA, Great Britain). Telephone metadata comes from libphonenumber-js/max. Unknown country strings require a selection; no number is accepted without valid parsing.

Saved E.164 numbers retain their actual telephone country even when it differs from the delivery country. Legacy national numbers use the saved address country. Changing the delivery country applies its telephone default once; selecting a different telephone country does not change the address. Contact and WhatsApp recipients share canonical E.164 only when explicitly linked. Recipient changes clear the current checkbox grant; saved consent still requires the exact saved recipient.

Checkout submits the canonical delivery phone. An unchanged saved address retains its address ID. When fields are edited, or a legacy national phone must be normalized, checkout sends a new address snapshot without the saved ID, since the backend deliberately resolves saved IDs from storage. Saved address records are not rewritten.

The staff order list returns 50 rows by default (maximum 100), with page, pageSize, total and totalPages. Its serializer never constructs notification activity, timeline, or inventory reconciliation. The individual detail endpoint retains those checks. Payment and legacy status filtering uses the existing canonical Python rules over a narrow projection, so ledger/refund rules are not reimplemented as approximate database expressions. Filtered queries still scan matching projected candidates; this remains a scaling limit for very large catalogues of orders.

Summary counts use one aggregation over projected financial and status inputs, grouping equivalent inputs before applying the existing canonical helpers. Returns includes requested, returned and refunded orders. There is no server summary cache. The browser may retain the last summary for five seconds during pagination/filter changes; the next list request after that interval requests fresh counts. Mounting Orders starts fresh, including after a detail/payment edit. No write path needs cache invalidation.

Routine GETs no longer run legacy migration. The existing guarded `flask --app wsgi:app database-maintenance` command remains the explicit migration path and now also creates order indexes. It requires an exact target database confirmation and existing maintenance guards. The existing bounded/idempotent migration implementation is preserved. Legacy list rows are interpreted without writes; detail normalization retains its existing behavior. Indexes are initialized once per application/database, protected by a process lock, and can also be initialized through maintenance.

Safe INFO timings cover order query/filtering, summary counts, row serialization, detail construction and total list time. They contain durations/counts only. They do not contain search text, identifiers, addresses, financial amounts, recipients or message content.

## Synthetic benchmark

Use `cd backend` then `python -m pytest tests/test_order_list_performance.py -q -s`.

The fixture has 220 synthetic orders and uses MongoMock only. Before changes, the first list returned 200 detailed rows in 490.12 ms and made 7,321 top-level collection calls: 4 index creations, 803 finds, 6,501 find_one calls, 12 counts and 1 distinct call (7,317 read operations). After changes, the first list returns 50 lightweight rows in approximately 54–61 ms with 7 calls: 4 index creations, 1 count, 1 find and 1 aggregate (3 read operations). Subsequent pages omit index initialization, and `includeCounts=false` also omits aggregation. Calls made internally by MongoMock are excluded from the instrumentation.

This demonstrates removal of per-row database work and the smaller response. It is not a production latency measurement or a MongoDB wire-query trace. Production performance and large-data aggregation costs require separate authorized measurement.
