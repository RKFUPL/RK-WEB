# Service communication permissions and Admin routing

Local changes only. No deployment or WhatsApp activation is authorized by this document.

## Updated routing model (24 November 2026)

This section supersedes the earlier customer channel-choice model above. Historical choice records are preserved for audit, but customer payloads, old `communicationPreferences` records and per-request `otpChannel` fields do not select operational delivery channels. No new customer channel-choice record is required at signup, profile save or checkout. Customers retain separate explicit and withdrawable Authentication, Transactional and Marketing WhatsApp permission controls.

Admin Studio Communication Channels persists `authenticationDeliveryMode` and `transactionalDeliveryMode`, each restricted to `email`, `whatsapp` or `both`. Defaults are Email for authentication (the deployed default OTP path) and Both for transactions (the deployed independent email/WhatsApp order path, still subject to WhatsApp gates). A legacy caller-selected OTP channel is intentionally no longer routing authority. Settings updates preserve unrelated fields and do not enqueue or replay anything.

The authentication service selects channels for signup, login, password reset and profile password-change verification. Email-only never queues a WhatsApp equivalent. WhatsApp-only has no silent Email fallback: missing permission, provider availability or approval produces a safe blocked/unavailable result. Both attempts the channels independently. Authentication challenge documents hold safe per-channel outcomes without codes or phone values in those diagnostic fields. Email ownership changes still require verification through the new Email address; if Email is administratively disabled, the operation stops with an explicit requirement for an administrator to configure Email or Both. A WhatsApp code never verifies ownership of an Email address.

Transactional email claims consult current Admin routing, including explicit retries. Disabled-channel skips have separate activity identities and do not overwrite existing accepted/held claims. Transactional WhatsApp is gated at notification creation and transport/worker dispatch, in addition to consent, templates and operational gates. Existing event/outbox/provider identifiers remain authoritative. Disabling a channel can prevent a pending job from dispatching; subsequently changing a setting does not replay historical jobs. Customer lifecycle emails, custom-order acknowledgements and return acceptance links respect the setting; internal operations notifications remain separate.

Profile linking parses international numbers using their actual country. Legacy national contact values require stored `phoneCountry`; unknown countries are never guessed. WhatsApp controls receive national digits and actual country, while saves use canonical E.164. Formatting-only contact changes retain the same recipient permission; actual recipient changes require fresh category authorization.

Terms and Privacy wording has also been updated from customer routing choice to administrator channel configuration. Qualified legal review remains required before publication. Live SMTP/Meta delivery, production settings and worker behavior have not been exercised by these mocked local checks.


## Local validation for this correction

- Full backend: 1,289 passed, 59 skipped; two MongoMock `utcnow()` deprecation warnings. Opt-in database/provider scenarios remain unverified here.
- Frontend unit tests: 190 passed.
- Focused signup/profile/checkout/Admin/phone browser checks: 59 passed with intercepted local APIs, including desktop/mobile screenshots.
- TypeScript, production frontend build, Python compilation and whitespace checks pass.
- Email ownership verification is deliberately blocked in WhatsApp-only mode; configure Email or Both to verify a new email address. Existing operational gates and template eligibility remain authoritative for WhatsApp.

## Current correction manifest

This correction touches the following files; other dirty files belong to the preserved earlier work.

- Backend implementation: `backend/app/communication_preferences.py`, `backend/app/blueprints/admin/routes.py`, `backend/app/blueprints/auth/routes.py`, `backend/app/blueprints/catalog/routes.py`, `backend/app/blueprints/payments/routes.py`, `backend/app/checkout_whatsapp.py`, `backend/app/notification_activity.py`, `backend/app/returns.py`, `backend/app/whatsapp.py`, `backend/app/whatsapp_orders.py`, `backend/app/whatsapp_routes.py`.
- Backend tests: `backend/tests/test_communication_preferences.py`, `backend/tests/test_signup_flow.py`, `backend/tests/test_storefront_settings.py`, `backend/tests/test_whatsapp.py`.
- Frontend implementation: `frontend/app/account/page.tsx`, `frontend/app/account/profile/page.tsx`, `frontend/components/admin/admin-settings.tsx`, `frontend/components/checkout/checkout-page.tsx`, `frontend/lib/legal-content.ts`, `frontend/lib/order-notifications.ts`.
- Frontend tests: `frontend/lib/communication-preferences.test.mjs`, `frontend/lib/order-notifications.test.mjs`, `frontend/tests/manual-payments.spec.ts`, `frontend/tests/whatsapp-ui.spec.ts`.
- Documentation: this file.

## Historical implementation notes (superseded)

Local implementation only. This document does not authorize deployment or activation of any WhatsApp gate.

## Policy

`whatsappConsentCollectionMode` defaults to `checkout`. That mode preserves the existing checkout checkbox and the legally acknowledged legacy mandatory-WhatsApp checkout policy. The existing legal warning and acknowledgement remain enforced. No environment or integration switch is changed by this setting.

`onboarding` requires the customer to choose channels separately for authentication and order updates. Email is a supported choice for either category. In this mode the legacy mandatory-WhatsApp flag does not force a WhatsApp grant; a completed account channel choice is required instead. New accounts choose during signup; existing accounts complete the step in Account Settings. Existing accounts are not backfilled and legacy booleans do not become grants. Backend checkout rejects missing choices before order/provider side effects.

`communicationPreferences` records a server-owned version, customer identity, source, timestamp, selected channels, recipient/country and references to relevant consent records. A separate append-only collection retains choice history. Existing WhatsApp consent records remain authoritative for delivery. A choice is not a grant. Authentication, transactional and Marketing categories retain separate evidence. New profile transactional grants require the explicit `whatsappTransactionalConsent` field; `whatsappNotifications: true` alone cannot manufacture a new grant. Existing valid grants for an unchanged recipient are reused without a new affirmative audit action.

The profile sends a new affirmative grant only after the customer explicitly checks that category for the current canonical recipient. A previously checked control loaded from the account is not submitted as a new consent action. Stale profile flags cannot override a later withdrawal. Authentication and Marketing also require their separate explicit grant fields when a new grant is needed. A narrow transactional withdrawal can leave independently authorized OTP requests eligible; broad signed STOP and unknown legacy suppressions remain broad. Conditional updates and the unique opt-out ID prevent a concurrent STOP from being downgraded by a narrower withdrawal.

Profile Same as contact phone selects a recipient only. It parses the actual international contact number into national digits and a telephone country. An independent input is retained while temporarily linked. Editing the WhatsApp control unlinks it. Changing a recipient clears current category selections and withdraws recorded grants for the previous primary recipient; it does not grant permission to the replacement. Canonical values and the actual country are stored by the backend.

Authentication still requires an explicit request for each OTP, a valid challenge, all existing gates and an eligible Authentication template. The profile preference selects the saved recipient only when its category-specific permission is valid. Pending challenges are checked against a later authentication withdrawal immediately before dispatch. General phone-level STOP controls remain authoritative and conservative. Selecting WhatsApp in profile does not make an unavailable Authentication integration available.

In onboarding checkout the account's verified grant can be snapshotted for the same recipient, without repeating a checkbox or creating a fresh grant. A changed recipient must be updated in Account Settings. Email-only and withdrawn accounts can continue using the existing email service paths. Checkout cannot save a new primary account grant in this mode. Existing email paths remain independent of WhatsApp; email availability, SMTP acceptance and delivery are not guaranteed by a preference choice. There is no new SMS fallback or automatic replay of historical notifications.

Newsletter, marketing email and WhatsApp Marketing controls remain separate, optional and initially false. They are not activated by channel selection, linking a number, signup or an OTP/transactional grant. General STOP retains its existing broad suppression; category-specific Marketing withdrawal remains independent from transactional permission.

## Legal review required before publication

Terms and Privacy share disclosures covering required service communications, channel choice, category-specific WhatsApp permission, withdrawal and independent optional Marketing. The operating company comes from the existing verified legal identity record. No blanket Utility/Authentication consent exemption is claimed.

The revised wording must be reviewed by qualified legal/compliance counsel before publication. It is implementation-aligned draft copy, not legal advice or a compliance certification. The legacy mandatory-WhatsApp checkout policy still carries its existing warning and should not be enabled without that separate review.

Policy reference reviewed: https://business.whatsapp.com/policy (opt-in and opt-out requirements). This is not a substitute for applicable local law or provider review.

## Verification boundaries

Backend regression tests use synthetic MongoMock documents and mocked OTP, SMTP, payment and WhatsApp boundaries. Browser tests use intercepted local APIs. No production database, VPS, Meta inventory, messages or customer records are used. Gates, templates and mappings are not enabled by this work. Existing checkout phone and Orders performance changes remain in the working tree.

## Files in this change

- Backend: `app/communication_preferences.py`, `app/blueprints/admin/routes.py`, `app/blueprints/auth/routes.py`, `app/blueprints/payments/routes.py`, `app/checkout_whatsapp.py`, `app/whatsapp.py`, `app/whatsapp_consent.py`, `app/whatsapp_marketing_consent.py` (all relative to `backend/`).
- Frontend: `app/account/page.tsx`, `app/account/profile/page.tsx`, `components/admin/admin-settings.tsx`, `components/checkout/checkout-page.tsx`, `lib/legal-content.ts`, `lib/whatsapp-consent.ts` (all relative to `frontend/`).
- Tests: `backend/tests/test_communication_preferences.py`, `frontend/lib/communication-preferences.test.mjs`, `frontend/tests/whatsapp-ui.spec.ts`, `frontend/tests/manual-payments.spec.ts`.
- Documentation: this file.

The checkout component and the two browser test files also contain preserved changes from the earlier checkout-phone and Orders-performance task. At the earlier implementation snapshot, the combined working tree contained 27 modified/untracked files, with 19 touched by that earlier task. No Git staging or release action is part of this work.
