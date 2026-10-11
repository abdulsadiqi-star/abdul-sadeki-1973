/**
 * Billing architecture of the monetization program — INTERFACE ONLY. No payment service is connected: the product
 * ships `NullBillingProvider`, which reports "not configured" for everything and never invents a number.
 * `docs/monetization-architecture.md` explains the ledger, idempotency, payout states, adapter and reconciliation
 * design a real provider must follow.
 *
 * Money is always an integer in the currency's smallest unit (never a float) with an explicit currency code.
 */

/** IRR = rial (no minor unit), IRT = toman (1 toman = 10 rials). */
export type CurrencyCode = 'IRR' | 'IRT';

export type Money = { amountMinor: number; currency: CurrencyCode };

/** Why a provider cannot answer. */
export type Unavailable = { status: 'unavailable'; reason: 'not_configured' | 'provider_error' };

export type Balance =
  | Unavailable
  | {
      status: 'ok';
      /** Can be requested as a payout now. */
      available: Money;
      /** Earned but not yet payable (holds, clearing). */
      pending: Money;
      /** ISO time of the provider's statement this was read from. */
      asOf: string;
    };

export type LedgerEntryKind = 'EARNING' | 'ADJUSTMENT' | 'PAYOUT' | 'PAYOUT_REVERSAL';

export type LedgerEntry = {
  id: string;
  kind: LedgerEntryKind;
  /** Signed: earnings and reversals are positive, payouts negative. */
  amount: Money;
  /** ISO time */
  createdAt: string;
  /** Opaque reference to the source (statement id, payout id…). */
  reference: string | null;
};

export type LedgerPage = Unavailable | { status: 'ok'; entries: LedgerEntry[]; nextCursor: string | null };

export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';

export type PayoutRequest = {
  amount: Money;
  /** Client-generated and unique per intended payout: repeating a request with the same key must not pay twice. */
  idempotencyKey: string;
};

export type PayoutResult = Unavailable | { status: 'ok'; payoutId: string; payoutStatus: PayoutStatus };

/** Extra, provider-side conditions (identity verification, payout account…) that gate payouts for a channel. */
export type PayoutReadiness =
  | Unavailable
  | { status: 'ok'; ready: boolean; blockers: { code: string; message: string }[] };

export interface BillingProvider {
  /** Stable id, e.g. "null", "zarinpal", "stripe". */
  readonly id: string;
  /** `false` for the null provider: UI shows the honest empty state instead of numbers. */
  readonly configured: boolean;
  /** Eligibility hook: may the channel receive payouts, beyond the program requirements? */
  getPayoutReadiness(channelId: string): Promise<PayoutReadiness>;
  getBalance(channelId: string): Promise<Balance>;
  /** Newest first, cursor-paginated. */
  listLedgerEntries(channelId: string, opts?: { cursor?: string | null; limit?: number }): Promise<LedgerPage>;
  /** Must be idempotent per `idempotencyKey`. */
  requestPayout(channelId: string, request: PayoutRequest): Promise<PayoutResult>;
}

const NOT_CONFIGURED: Unavailable = { status: 'unavailable', reason: 'not_configured' };

/** The provider this product ships with: nothing is connected, so nothing is reported. */
export class NullBillingProvider implements BillingProvider {
  readonly id = 'null';
  readonly configured = false;

  async getPayoutReadiness(): Promise<PayoutReadiness> {
    return NOT_CONFIGURED;
  }
  async getBalance(): Promise<Balance> {
    return NOT_CONFIGURED;
  }
  async listLedgerEntries(): Promise<LedgerPage> {
    return NOT_CONFIGURED;
  }
  async requestPayout(): Promise<PayoutResult> {
    return NOT_CONFIGURED;
  }
}

const nullProvider = new NullBillingProvider();

/**
 * The single switch point for billing: when a payment service is integrated, select its adapter here from
 * configuration (for example an env var naming the provider). Everything else depends only on `BillingProvider`.
 */
export function getBillingProvider(): BillingProvider {
  return nullProvider;
}
