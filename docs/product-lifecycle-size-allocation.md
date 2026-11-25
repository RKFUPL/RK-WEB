# Product lifecycle and size allocation

Product lifecycle uses the existing `status` values: `draft`, `active`, `archived`. Availability (`in_stock`, `custom_order`, `sold_out`) and stock are independent. The collection table and drawer show lifecycle explicitly. Activate/Deactivate uses the products permission and changes only lifecycle fields plus its audit. Deactivate returns to draft, following the existing lifecycle vocabulary; it does not archive or remove collection membership. Existing catalogue visibility policy for drafts is unchanged.

Activation requires a saved name, parent SKU, positive finite original MRP, a browser-safe product/colour gallery image and, for colour products, an active canonical colour ID/SKU. It does not require positive stock. No stock operation activates a product.

Sale exclusions include the central ID/code and a link to the exact collection drawer using `?productId=<central ID>`. Returning focus refreshes eligibility without resetting unsaved assignments. Sale still requires Active status, valid MRP and its established variant rules. Custom-order stock may be zero.

## Explicit allocation

The Pricing & inventory tab uses actual saved colour/size buckets, including nonstandard sizes. Products without size buckets retain aggregate adjustment. Each row carries the saved variant ID, SKU and size; the API rejects missing, duplicate or mismatched identities and negative/fractional quantities. A reason is required on every save.

There is no automatic database migration. The first allocation must equal existing physical stock, without counting parent and variant totals twice. A conflicting positive aggregate and variant total blocks allocation for staff investigation. Removed colours or disabled sizes retaining stock also block allocation. Six unallocated aggregate units remain six units until staff explicitly assigns all six across sizes. No arbitrary default quantities are assigned.

Enabling allocation sets `inventoryAllocationMode` to `size` or `variant_size`. Parent size mode uses existing `sizeInventory`; colour mode uses existing `variants[].sizeInventory` and derives each variant total and the parent summary. Parent size buckets are cleared only during an explicit colour allocation; their previous values remain in the atomic audit. Each allocation increments `inventoryAllocationRevision`.

Stock updates and `inventoryAllocationHistory` are written atomically in the product document. The audit contains the actor, timestamp, reason and complete before/after allocation fields. Existing `inventory_adjustments` history is untouched. An inventory revision and compare-and-set predicates fence concurrent variant/size/stock/operation-marker changes. The previous aggregate and variant editing paths reject quantity changes after allocation mode is enabled. Capture deductions, manual reservation/release and capture compensation update the parent summary in the same atomic stock write only for explicitly allocated colour mode.

No force-reconciliation mechanism is supplied. If existing parent/colour totals disagree, or durable operation evidence is unresolved, staff should investigate the original records and audit before allocation. This work does not modify historical order snapshots, payment amounts, provider evidence, inventory markers or messaging settings.

## Evidence limits

After the user confirmed the configured remote database was a test database, a direct read-only inspection was explicitly restricted to `RK_WEB_TEST_N2` without creating the application or running seed/bootstrap code. AURELIA ID `6adda708971eb7cdde741605` has lifecycle `draft`, `isActive: true`, availability `in_stock`, MRP 188004 and aggregate stock 6. Three active colour variants each have five zero-stock size buckets. Collection `aakaar` ID `6acf4c62519cf170ea17c784` resolves five product IDs, including this same AURELIA ID. The Sale selection function returns this same ID with the inactive-lifecycle reason; zero of the five current test records are sale-eligible. No record was activated or allocated.

The current stored name is AURELIA, not AURELIA - TEST. No import/source provenance fields were present, so the origin of that earlier label and whether it was an imported or manually created draft were not inferred. Production uses a different database and its IDs/statuses are not established by this inspection. No production database or VPS was accessed.

Tests use synthetic MongoMock data and isolated Flask browser routes, with payment, email and WhatsApp transports mocked/blocked. They prove application behaviour locally, not production database concurrency or actual provider behaviour. Real MongoDB concurrency validation is still required for the new allocation endpoint before a controlled production release.
