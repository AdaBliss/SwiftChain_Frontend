/**
 * Represents the details of an escrow contract fetched from the blockchain.
 */
export interface EscrowDetails {
  requiredSignatures: number;
  currentSignatures: number;
  isReleased: boolean;
  signers: string[];
}

/**
 * The response structure after a successful fund release transaction.
 */
export interface ReleaseFundsResponse {
  success: boolean;
  transactionHash: string;
}
/**
 * Fee inputs for an escrow payout, returned by the backend payout quote API.
 * All amounts are denominated in `currency`.
 */
export interface PayoutFeeQuote {
  /** Gross amount currently held in escrow. */
  escrowAmount: number;
  /** Asset code of the escrow, e.g. `XLM` or `USDC`. */
  currency: string;
  /** Platform commission as a percentage of the escrow amount, e.g. `2.5`. */
  platformFeePercent: number;
  /** Estimated network (gas) cost of the release transaction, in `currency`. */
  estimatedGasFee: number;
}

/**
 * Derived payout breakdown shown in the release confirmation view.
 */
export interface PayoutFeeBreakdown {
  currency: string;
  grossAmount: number;
  platformFeePercent: number;
  platformFee: number;
  estimatedGasFee: number;
  /** Amount the driver receives after fees. Never negative. */
  netPayout: number;
}
