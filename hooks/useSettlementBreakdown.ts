'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  escrowSettlementService,
  SettlementServiceError,
} from '@/services/escrowSettlementService';
import {
  formatAssetAmount,
  formatRate,
  getStellarExplorerTxUrl,
} from '@/lib/settlementFormatters';
import type {
  FormattedSettlementAmounts,
  FormattedTaxWithholding,
  SettlementBreakdown,
} from '@/types/settlementBreakdown';

export const DEFAULT_SETTLEMENT_POLL_INTERVAL_MS = 5000;
const MAX_RETRIES = 2;

export const settlementBreakdownKeys = {
  all: ['settlementBreakdown'] as const,
  detail: (escrowId: string) => ['settlementBreakdown', escrowId] as const,
};

export interface UseSettlementBreakdownOptions {
  /** Interval used while the settlement is still finalizing. */
  pollIntervalMs?: number;
  enabled?: boolean;
}

export interface UseSettlementBreakdownResult {
  settlement: SettlementBreakdown | null;
  formatted: FormattedSettlementAmounts | null;
  taxBreakdown: FormattedTaxWithholding[];
  explorerUrl: string | null;
  isLoading: boolean;
  isFetching: boolean;
  /** True while polling for the settlement to reach a terminal state. */
  isFinalizing: boolean;
  isTerminal: boolean;
  error: string | null;
  refetch: () => void;
}

function shouldRetry(failureCount: number, error: Error): boolean {
  // Client errors (e.g. 404 settlement not found) will not resolve on retry.
  if (error instanceof SettlementServiceError && error.status !== null && error.status < 500) {
    return false;
  }
  return failureCount < MAX_RETRIES;
}

function roundAssetAmount(amount: number): number {
  return Math.round(amount * 1e7) / 1e7;
}

/**
 * Fetches the finalized settlement breakdown for an escrow after release.
 * Polls while the release transaction is still pending/finalizing and stops
 * once the settlement is confirmed or failed.
 */
export function useSettlementBreakdown(
  escrowId: string | null | undefined,
  { pollIntervalMs = DEFAULT_SETTLEMENT_POLL_INTERVAL_MS, enabled = true }: UseSettlementBreakdownOptions = {},
): UseSettlementBreakdownResult {
  const query = useQuery({
    queryKey: settlementBreakdownKeys.detail(escrowId ?? ''),
    queryFn: ({ signal }) => escrowSettlementService.getSettlement(escrowId as string, signal),
    enabled: enabled && !!escrowId,
    retry: shouldRetry,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data || q.state.status === 'error') return false;
      return escrowSettlementService.isTerminalStatus(data.status) ? false : pollIntervalMs;
    },
  });

  const settlement = query.data ?? null;

  const derived = useMemo(() => {
    if (!settlement) {
      return { formatted: null, taxBreakdown: [], explorerUrl: null };
    }

    const { asset } = settlement;
    const taxBreakdown: FormattedTaxWithholding[] = settlement.taxWithholdings.map((tax) => ({
      ...tax,
      formattedAmount: formatAssetAmount(tax.amount, asset),
      formattedRate: formatRate(tax.rate),
    }));
    const totalTaxWithheld = roundAssetAmount(
      settlement.taxWithholdings.reduce((sum, tax) => sum + tax.amount, 0),
    );

    const formatted: FormattedSettlementAmounts = {
      totalEscrowAmount: formatAssetAmount(settlement.totalEscrowAmount, asset),
      driverPayout: formatAssetAmount(settlement.driverPayout, asset),
      platformFee: formatAssetAmount(settlement.platformFee, asset),
      platformFeeRate: formatRate(settlement.platformFeeRate),
      totalTaxWithheld: formatAssetAmount(totalTaxWithheld, asset),
      heldAmount: formatAssetAmount(settlement.heldAmount, asset),
      remainingBalance: formatAssetAmount(settlement.remainingBalance, asset),
    };

    const explorerUrl = settlement.transactionHash
      ? getStellarExplorerTxUrl(settlement.transactionHash, settlement.network)
      : null;

    return { formatted, taxBreakdown, explorerUrl };
  }, [settlement]);

  const isTerminal = settlement ? escrowSettlementService.isTerminalStatus(settlement.status) : false;

  return {
    settlement,
    ...derived,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFinalizing: !!settlement && !isTerminal && !query.isError,
    isTerminal,
    error: query.error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
