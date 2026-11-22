# Order-placed WhatsApp routing correction

## Evidence (2026-11-22)

A read-only production configuration inspection found no explicit `order_placed`
entry in `WHATSAPP_TEMPLATES`. The deployed catalogue therefore defaulted to
`rk_order_placed`: UTILITY/en_US, disabled and not verified, with the four ordered
parameters `customer_name`, `order_number`, `items_summary`, `order_total`.
This explains the supplied zero-attempt skipped notification; no customer order
or message records were modified or replayed during this investigation.

The operator's production inventory refresh reported at **2026-11-22 17:37:03
IST** identifies APPROVED `order_received` / UTILITY / en_US with a TEXT header
`Order Received`, four-variable BODY containing exactly `Order total: {{4}}`,
and TEXT footer `Rashi Kapoor Official`. There are no buttons. Submission examples
are not component definitions. The BODY does not end in the old `progresses.Hello`.

The previous local definition inherited the legacy draft's static rupee prefix,
`Order total: ₹{{4}}`. That differs from the reported approved contract.
The earlier exact-match claim and recorded signature are withdrawn as proof of
the current contract; retaining them would misrepresent production verification.
`order_received` now has an independent, explicit BODY with `Order total: {{4}}`.
The legacy `rk_order_placed` draft remains unchanged.

For this contract only, the fourth dynamic parameter uses the existing `money()`
formatter with a rupee currency prefix (for example, `₹ 1,250.00`). The
rendered amount therefore has exactly one currency symbol. Numeric calculations,
stored amounts, rounding, legacy parameters and the seven-variable update
contract are unchanged.

These corrections were checked locally with synthetic storage and mocked Meta
responses. No production/Meta access or refresh was performed for this correction.
**Production component verification has not been confirmed.** After deployment,
an authorized fresh current-WABA inventory refresh must verify the complete
corrected HEADER/BODY/FOOTER before any separately approved activation. Runtime
approval still requires fresh, scoped evidence; no approvals are imported locally.

## Resolution and safeguards

`EVENT_CATALOGUE["order_placed"]` explicitly selects `order_received`, independent
of catalogue insertion order. An absent mapping defaults to disabled. Explicit
legacy mappings remain visibly blocked with
`legacy_template_mapping_requires_migration`; they are never silently replaced
or used to send. The old draft definition is retained.

The planner preserves all existing entries unless the operator explicitly opts
into replacing the legacy placed-order entry. Migration and enabling are separate
choices. Both require fresh scoped APPROVED/UTILITY/en_US evidence, exact full
components and the four-variable contract. Preserving an old entry is reported
as incompatible, with `migrationAppliedToProposal=false`, never as a migration.
The planner does not write configuration, cache approvals, enqueue, replay or send.

The seven-variable update contract, all other event mappings, consent, general
messaging/Marketing/OTP gates, order-only authorization and idempotency are unchanged.
Order placement and email remain independent of WhatsApp availability.

## Production action still required (not performed)

1. Review and deploy this commit through the existing protected maintenance and
   immutable-image workflow. This commit uses `[skip deploy]`; pushing is not deployment.
2. Through the existing authorized inventory refresh, obtain fresh observations
   using the deployed corrected definitions. Verify current WABA identity, exact
   components/signature and APPROVED/UTILITY/en_US again. Stale or old-body evidence
   must block activation.
3. Privately prepare a proposal using the actual runtime configuration:

   ```python
   plan = plan_order_template_mappings(
       db, config, enable_events={"order_placed"}, migrate_order_placed=True)
   ```

   Do not log the full environment or proposal. Review the `order_placed` check
   and compare every unrelated entry to the current configuration. On the inspected
   production configuration, this adds a missing entry; on an explicit legacy
   configuration, the migration opt-in permits replacing only that entry.
4. With separate explicit production authorization, merge only the reviewed
   `order_placed` entry into the existing `WHATSAPP_TEMPLATES` assignment. It must
   name/catalogue `order_received`, use en_US/UTILITY, the four parameters above,
   four text parameter types, and `enabled=true`. Preserve every other mapping,
   disabled entry, secret and gate. Apply configuration using existing maintenance
   procedures; verify backend and worker evidence before timer recovery.
5. Do not replay the historical skipped order or create a customer test send.
   This correction supplies no replay operation or automatic historical retry.

No production environment, templates, gates, mappings, services or timers were
changed. Tests use synthetic storage and mocked transport only.
