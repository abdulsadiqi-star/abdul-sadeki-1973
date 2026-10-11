# Monetization architecture

Status of this document: **what exists today** is §1; everything from §3 on is the **design a real payment integration
must follow**. Nothing in §3–§9 is implemented, no table for it exists, and the product shows no revenue figure anywhere.

## 1. What exists today

| Piece | Where | Notes |
|---|---|---|
| Requirements | `src/config/site.ts` `monetizationRequirements` | 1,000 followers, 500 watch hours in the last 365 days, 5 public videos |
| Eligibility math | `src/features/monetization/eligibility.ts` | Pure function; unit tested (`tests/unit/monetization.test.ts`) |
| Real statistics | `features/monetization/queries.ts` | Only `source = 'REAL'` events count. SEED events are reported separately and never make a channel eligible |
| Application flow | `features/monetization/{service,actions,rules}.ts` | `MonetizationApplication`; creator side only (below) |
| Billing seam | `features/monetization/billing.ts` | `BillingProvider` interface and `NullBillingProvider`; `getBillingProvider()` always returns the null provider |
| Revenue UI | `/studio/monetization` | Honest empty state: «درآمدی ثبت نشده است — اتصال به سرویس پرداخت هنوز انجام نشده» |

Application lifecycle (`MonetizationStatus`). Creators can only create `DRAFT` and `SUBMITTED`; every other value is
written by a reviewer in the admin panel (which owns those transitions and sends the `MONETIZATION_UPDATE` notification).
Typical path:

```
DRAFT --submit (eligible, terms accepted)--> SUBMITTED --> UNDER_REVIEW --> APPROVED --> SUSPENDED
  ^                                              |              |
  +---------- withdraw (SUBMITTED only) ---------+              +--> REJECTED   (a new application may then be started)
```

Rules enforced on the server, inside one transaction that first takes `pg_advisory_xact_lock(hashtext('monetization:'||channelId))`:
one *active* application per channel (DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, SUSPENDED); eligibility, terms and "channel not
suspended" are re-checked at submit time and the figures decided on are stored as `statsSnapshot`; withdrawing is possible
only while `SUBMITTED` and returns the row to `DRAFT` with the snapshot cleared. Reviewer code must update conditionally
(`where: { id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }`) so a decision cannot overwrite a withdrawal.

**Analytics are not a financial record.** `ViewEvent` rows are deduplicated per viewer key, can be synthetic and are not audited
for invalid traffic. They decide *eligibility to apply*; they must never be multiplied by a rate to produce money. Revenue
comes only from a provider's statements (§3).

## 2. Principles

1. Money is an **integer in the smallest unit plus a currency code** (`Money` in `billing.ts`); never a float. IRR has no minor
   unit; IRT is 10 IRR. Use `BIGINT` in the database.
2. The ledger is **append-only**; balances are derived. A mistake is fixed with a new, explained entry, never an edit.
3. Every money-moving operation is **idempotent** and keyed by something stable.
4. A provider that cannot answer yields `{ status: 'unavailable' }`, never a guessed number.
5. The provider's statements are the source of truth for *earned*; our ledger is the source of truth for *owed and paid*;
   a bank/gateway settlement report is the source of truth for *moved*. Reconciliation (§7) compares the three.

## 3. Ledger design (proposed)

Double-entry, because payouts, holds, fees and corrections all move value between accounts and the books must balance.

```
LedgerAccount      id, kind (CREATOR_PAYABLE | PLATFORM_REVENUE | PAYOUT_CLEARING | PROVIDER_FEES), channelId?, currency
LedgerTransaction  id, kind (EARNING | ADJUSTMENT | PAYOUT_RESERVE | PAYOUT_REVERSAL | PAYOUT_SETTLED), source, externalRef,
                   memo, createdById?, createdAt                      UNIQUE (source, externalRef)
LedgerEntry        id, transactionId, accountId, amountMinor (signed BIGINT), currency, availableAt?
RevenueStatement   id, provider, externalRef, channelId, periodStart, periodEnd, grossMinor, creatorShareMinor, currency, importedAt
                                                                       UNIQUE (provider, externalRef)
```

Invariants (enforced in code, checked by reconciliation, ideally also by constraints/triggers):

- The entries of one transaction sum to zero per currency. Entries are never updated or deleted (revoke `UPDATE/DELETE` from the app role).
- `(source, externalRef)` is unique, so re-importing a statement or replaying a webhook creates nothing new.
- A creator's balance = `SUM(amountMinor)` over their `CREATOR_PAYABLE` account. *Available* excludes entries with `availableAt > now`
  (holds/clearing); *pending* is the held part. An optional cached balance row is updated in the same transaction and verified nightly.
- Posting that reduces a balance (payout reserve) takes a per-channel lock (advisory lock, as for applications) and re-reads the balance
  inside the transaction, so two concurrent payouts cannot overspend.
- Financial records are retained even after account deletion (anonymise the person, keep the entries).

## 4. Idempotency

- **Payout request**: the client sends a generated `idempotencyKey` (UUID per intended payout, kept across retries/double clicks). Unique on
  `(channelId, idempotencyKey)`. Same key and same payload returns the original result; same key and different payload is a 409.
- **Calls to the provider** carry our payout id as the provider's client reference/idempotency key. After a timeout or 5xx the worker
  *queries the provider by that reference first* and only then decides to retry, so an unknown outcome never causes a second payment.
- **Statement imports and webhooks** are keyed by `(provider, externalRef)` / event id; handlers verify the signature, dedupe, post in one
  transaction and acknowledge quickly (long work goes to the job queue).
- **State changes** are conditional updates (`UPDATE … WHERE id = ? AND status = <expected>`); zero rows updated means someone else got there first.

## 5. Payout states

```
REQUESTED --> APPROVED --> PROCESSING --> PAID
    |            |             |
    +-> CANCELLED <------------+--> FAILED          (CANCELLED only before PROCESSING; PAID, FAILED, CANCELLED are terminal)
```

- `REQUESTED`: the creator asked; a `PAYOUT_RESERVE` transaction immediately moves the amount out of *available* (so it cannot be spent twice).
- `APPROVED`: passed automatic checks (application is `APPROVED`, not `SUSPENDED`; minimum amount; verified payout destination; provider
  `getPayoutReadiness` says ready; no other payout in flight) and, above a threshold, a second person's approval (separation of duties).
- `PROCESSING`: handed to the provider; only the provider's webhook/status query moves it on.
- `PAID`: provider confirmed; `PAYOUT_SETTLED` moves the reserve from clearing to cash, with the provider reference stored.
- `FAILED` / `CANCELLED`: a `PAYOUT_REVERSAL` returns the reserved amount to *available*. A chargeback or recall after `PAID` is an `ADJUSTMENT`
  with a reason and the admin's id, never a status rewind.

Each transition writes an immutable `PayoutEvent` (from, to, actor, reason, provider payload hash) in the same transaction as its ledger postings.

## 6. Provider adapter

`BillingProvider` (`features/monetization/billing.ts`) is the only thing the rest of the code depends on:

| Method | Purpose | Failure behaviour |
|---|---|---|
| `getPayoutReadiness(channelId)` | Provider-side gates (identity verification, payout account) | `unavailable`, never "ready" by default |
| `getBalance(channelId)` | `available`, `pending`, `asOf` | `unavailable` |
| `listLedgerEntries(channelId, {cursor, limit})` | Newest first, cursor-paginated, signed amounts | `unavailable` |
| `requestPayout(channelId, {amount, idempotencyKey})` | Idempotent per key | `unavailable` or a payout id and status |

To integrate a provider: implement the interface in `features/monetization/providers/<name>.ts`, select it in `getBillingProvider()` from
configuration (an env var plus its secrets, validated in `lib/env`), keep secrets out of logs, set explicit timeouts and a circuit breaker,
map provider errors to `provider_error` (the UI then says the service is temporarily unreachable, not "no revenue"), and run the shared
contract test-suite against both a sandbox account and a `FakeBillingProvider` that lives in `tests/` only. Add the ledger tables with an
additive migration (see `docs/conventions.md` §10). Until `configured` is true the UI keeps rendering the empty state.

## 7. Reconciliation

A scheduled job (daily, plus on demand for admins) compares, per provider and period: (a) statement totals against posted `EARNING`
transactions, (b) our `Payout` statuses against the provider's, (c) the sum of `PAYOUT_SETTLED` against the settlement/bank report, (d) the cached
balances against `SUM(entries)`, and (e) payouts stuck in `PROCESSING` longer than a threshold (asks the provider for the real state).
Differences become `ReconciliationIssue` rows and an admin alert. **The job never edits money silently**: a fix is an explained `ADJUSTMENT`
approved by a person and recorded in an audit table (`ModerationAction` is the existing precedent for admin decisions).

## 8. Compliance notes (engineering checklist, not legal advice)

- Take legal and tax advice for the operating jurisdiction before enabling payouts: tax invoicing/withholding, who may receive money, and
  which payment services are permitted.
- Verify the creator's identity and payout destination before the first payout; store tokens or masked values, never full card/IBAN numbers
  in logs or analytics.
- Publish the program terms the creator accepts (stored today as `acceptedTermsAt`; store the *version* of the terms when they exist) and show
  the revenue share before any figure is shown.
- Keep an audit trail of every admin action on applications, payouts and adjustments; limit those actions to roles that need them.
- Filter invalid traffic before it can earn anything; the existing `source` flag and viewer-key deduplication are the starting point, not the end.
- Retain financial records for the legally required period; deletion requests anonymise people, not ledger rows.
- Rate-limit and alert on payout requests; require re-authentication (password or e-mail confirmation) to change a payout destination.

## 9. Not covered / open questions

Revenue source and rate card (ads, memberships, tips), currency of display, payout schedule and minimum, multi-owner channels,
and refunds of the viewer-side payments that fund the earnings. These are product decisions that the ledger above is agnostic to.
