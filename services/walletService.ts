import api from '@/lib/api';
import type {
  PendingMultiSigResponse,
  SignMultiSigParams,
  SignMultiSigResponse,
} from '@/types/multiSig';

export interface WalletBalance {
  available: number;
  locked: number;
  pending: number;
  total: number;
  currency: string;
}

export interface BalanceCheckResult {
  hasSufficientBalance: boolean;
  balance: WalletBalance;
  requiredAmount: number;
}

class WalletService {
  private static instance: WalletService;
  private balanceCache: WalletBalance | null = null;
  private lastFetchTime: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  private constructor() {}

  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  /**
   * Fetch wallet balance from backend API
   * Uses cache to prevent unnecessary API calls
   */
  async fetchBalance(forceRefresh = false): Promise<WalletBalance> {
    // Check cache first
    if (!forceRefresh && this.isCacheValid()) {
      return this.balanceCache!;
    }

    try {
      const response = await fetch('/api/wallet/balance', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch balance: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Validate response structure
      const balance: WalletBalance = {
        available: data.data.available || 0,
        locked: data.data.locked || 0,
        pending: data.data.pending || 0,
        total: data.data.total || 0,
        currency: data.data.currency || 'USD',
      };

      // Update cache
      this.balanceCache = balance;
      this.lastFetchTime = Date.now();

      return balance;
    } catch (error) {
      console.error('Error fetching wallet balance:', error);
      // Return cached balance if available, otherwise default
      if (this.balanceCache) {
        return this.balanceCache;
      }
      throw error;
    }
  }

  /**
   * Check if user has sufficient balance for a transaction
   */
  async checkSufficientBalance(requiredAmount: number): Promise<BalanceCheckResult> {
    const balance = await this.fetchBalance();
    const hasSufficient = balance.available >= requiredAmount;

    return {
      hasSufficientBalance: hasSufficient,
      balance,
      requiredAmount,
    };
  }

  /**
   * Get cached balance immediately (synchronous)
   * Used for optimistic UI updates
   */
  getCachedBalance(): WalletBalance | null {
    return this.balanceCache;
  }

  /**
   * Pre-fetch balance for future use
   */
  async prefetchBalance(): Promise<void> {
    try {
      await this.fetchBalance();
    } catch (error) {
      // Silently fail - we'll try again later
      console.debug('Balance prefetch failed:', error);
    }
  }

  private isCacheValid(): boolean {
    return (
      this.balanceCache !== null &&
      Date.now() - this.lastFetchTime < this.CACHE_DURATION
    );
  }

  /**
   * Fetch pending multi-signature operations awaiting the given wallet's approval.
   */
  async getPendingMultiSigOperations(walletAddress: string): Promise<PendingMultiSigResponse> {
    const { data } = await api.get<PendingMultiSigResponse>('/wallet/multi-sig/pending', {
      params: { walletAddress },
    });
    return data;
  }

  /**
   * Submit a signature for a multi-sig operation. The backend broadcasts the
   * transaction once all required signatures are collected.
   */
  async signMultiSigOperation(params: SignMultiSigParams): Promise<SignMultiSigResponse> {
    const { data } = await api.post<SignMultiSigResponse>('/wallet/multi-sig/sign', params);
    return data;
  }

  /**
   * Clear the cache (useful for logout or balance updates)
   */
  clearCache(): void {
    this.balanceCache = null;
    this.lastFetchTime = 0;
  }
}

export const walletService = WalletService.getInstance();