/**
 * Represents the details of an escrow contract fetched from the blockchain.
 */
export interface EscrowDetails {
  requiredSignatures: number;
  currentSignatures: number;
  isReleased: boolean;
  signers: string[];
  status?: 'released' | 'locked' | 'pending';
}

/**
 * Parameters for locking escrow funds.
 */
export interface LockEscrowParams {
  deliveryId: string;
  amount: number;
  currency: string;
  walletAddress: string;
}

/**
 * Response structure after a successful lock transaction.
 */
export interface LockEscrowResponse {
  success: boolean;
  message: string;
  escrowId: string;
  transactionHash: string;
  lockedAmount: string;
}

/**
 * Parameters for releasing escrow funds.
 */
export interface ReleaseEscrowParams {
  escrowId: string;
  deliveryId: string;
  walletAddress: string;
}

/**
 * Response structure after a successful release transaction.
 */
export interface ReleaseEscrowResponse {
  success: boolean;
  message?: string;
  transactionHash?: string;
}

/**
 * The response structure after a successful fund release transaction.
 */
export interface ReleaseFundsResponse {
  success: boolean;
  transactionHash: string;
}