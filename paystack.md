# Paystack Integration Readiness Notes

## Overview

This document captures the updates completed while preparing the codebase to support Paystack alongside Stripe. The work focused on three main areas:

1. Making the shared fee utilities provider-aware so that Paystack-specific pricing rules can be expressed without affecting existing Stripe behaviour.
2. Extending persistence and server logic to track which processor handled each payment method or transaction.
3. Refreshing application and worker flows (UI/API/cron) so they respect the new provider metadata and remain safe for Stripe-only environments until Paystack endpoints are introduced.

The changes intentionally stop short of wiring up live Paystack routes. Instead, they harden the foundation (types, schema, data flow) needed to bolt Paystack functionality on top of the current stack.

---

## Shared Libraries

### `packages/shared/src/fees.ts`

- Introduced `PaymentProvider` (`"stripe" | "paystack"`) and `PaymentChannel` (`"card" | "mobile_money"`) types.
- Updated `FeeBreakdown` and `FeeCalculationInput` to include provider/channel context. The calculation is now provider-aware:
  - For Stripe, the previous logic (fixed 0.35 USD + 2.9% and an optional 1.5% international uplift) is preserved.
  - For Paystack, mobile money is billed at 1.5%, while cards use a 10 KES flat fee plus 3.5% (values can be tuned later).
- All fees are returned as `providerFee`, `internationalFee`, `planFee`, `totalFees`, and `totalAmount`, rounded to cents and accompanied by the `paymentProvider` for rendering and audit trails.

These updates guarantee that an existing Stripe experience remains identical, while callers can opt-in to Paystack pricing simply by supplying `paymentProvider: "paystack"` and an optional `channel`.

---

## Database Schema

### `packages/db/src/schema.ts`

- `transaction` table:
  - Added a `provider` enum column defaulting to `"stripe"` so every ledger entry records which processor executed the payment.
  - Added optional `paystackReference` and `paystackInvoiceId` fields to mirror Stripe’s identifiers when Paystack support lands.
- `payment_method` table:
  - Added `provider` enum (default `"stripe"`).
  - Relaxed `stripePaymentMethodId` to nullable and introduced `paystackAuthorizationCode`.
  - Stored card brand/last4 at rest so a failed card refresh still renders useful labels.
  - Ensured `updatedAt` auto-updates for bookkeeping consistency.

> ⚠️ **Migration Required:** Generate a Drizzle migration before deploying. The schema file is updated, but no SQL snapshot was produced in this pass.

---

## API Changes

### `apps/api/src/routes/payments.ts`

- Imported `logger` to surface diagnostic messages when Stripe lookups fail.
- `GET /payments/payment-methods` now returns provider-aware payloads. Stripe entries are enriched with the latest card metadata (or fall back to cached values), while other providers are passed through untouched.
- Stripe-only operations (set default method, delete saved method, top-up with saved method) now explicitly reject non-Stripe payment methods to guard against future Paystack additions.
- `POST /payments/create-payment-intent` and `POST /payments/top-up-with-saved-method` invoke `calculateFees` with `paymentProvider: "stripe"` to keep Stripe pricing unambiguous.
- `POST /payments/calculate-fees` tracks the provider tied to the selected payment method, allowing UI clients to show accurate fee copy even before Paystack endpoints exist.
- OpenAPI schemas (`zod` objects) were updated to match new response shapes (`providerFee`, `paymentProvider`, nullable identifiers, etc.).

### `apps/api/src/stripe.ts`

- When handling setup intents, every stored payment method now records `provider: "stripe"` plus cached `cardBrand`/`cardLast4`.
- All transaction inserts and fallbacks (checkout sessions, payment intent success/failure, subscription lifecycle) now set `provider: "stripe"`.
- No behavioural change for Stripe customers, but the data trail is ready for reports that split revenue by processor.

---

## Worker Updates

### `apps/worker/src/worker.ts`

- The auto top-up job ignores organizations whose default payment method is not Stripe (or lacks a Stripe payment method ID) to prevent accidental attempts against future Paystack records.
- Fee calculations and pending transactions use `paymentProvider: "stripe"` to stay consistent with the new fee engine and schema columns.

---

## Frontend Adjustments

### Shared API Types

- `apps/ui/src/lib/api/v1.d.ts` and `apps/playground/src/lib/api/v1.d.ts` were regenerated in place to reflect new REST response contracts (provider metadata, nullable identifiers, provider-aware fee breakdown).

### UI Components

- Credit top-up dialogs (`apps/ui` and `apps/playground`) now:
  - Show “Paystack processing fees” when the server reports a Paystack calculation.
  - Tolerate missing card metadata (streamed from cached DB fields when Stripe lookup fails).
  - Filter list displays to Stripe entries while Paystack support remains pending.
- Auto top-up settings only consider Stripe payment methods when enforcing “default payment method” requirements and when rendering fee estimates.

The UI changes are backwards compatible—the underlying fee numbers for Stripe do not change—while preparing the components to surface Paystack fees once the endpoints arrive.

---

## Verification & Follow-Up Tasks

1. **Drizzle Migration**: Run `pnpm db:generate` (or the repo’s migration helper) to produce SQL for the new columns, then apply it to dev/staging databases.
2. **Type Regeneration**: If OpenAPI clients are generated elsewhere, ensure they pick up the new response shapes to avoid drift.
3. **Testing**: Execute `pnpm lint`, `pnpm test:unit`, and any Stripe-focused e2e suites to confirm no regressions (tests were not run here).
4. **Paystack API Layer** _(future work)_:
   - Implement Paystack customer creation, top-up initialization, and webhook handlers using the new schema.
   - Extend the UI to expose Paystack payment flows once endpoints stabilize.
5. **Metrics/Reporting**: Update dashboards or BI exports to include the `provider` column if downstream analytics expect it.

---

## Known Limitations

- Paystack endpoints are not yet exposed; all references funnel through Stripe logic. This is deliberate until the Paystack implementation is complete.
- The fee constants for Paystack are placeholders based on current pricing; validate them against the latest Paystack documentation before launch.
- Existing data rows lack `provider` values until a migration/backfill is executed. Run an update script setting existing Stripe records to `"stripe"` post-migration.

---

## Summary

These foundational changes keep the production Stripe experience untouched while introducing the schema, typing, and fee logic needed for Paystack. The repository is now primed for a focused Paystack branch that implements the actual REST handlers and frontend affordances without reworking shared infrastructure again.
