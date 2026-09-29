'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  DEFAULT_PAYOUT_PAGE_SIZE,
  EarningsServiceError,
  earningsService,
} from '@/services/earningsService';
import { useWalletStore } from '@/store/walletStore';
import type { EarningsSummary, PayoutHistory } from '@/types/earnings';

const SUMMARY_STALE_MS = 30_000;

export const driverEarningsKeys = {
  all: ['driverEarnings'] as const,
  summary: (address: string) => ['driverEarnings', address, 'summary'] as const,
  payouts: (address: string, pageSize: number) =>
    ['driverEarnings', address, 'payouts', pageSize] as const,
};

export interface UseDriverEarningsOptions {
  /** Number of payouts requested per page. */
  pageSize?: number;
}

export interface UseDriverEarningsResult {
  summary: EarningsSummary | null;
  available: number;
  pending: number;
  total: number;
  currency: string | null;
  /** Payouts from every page loaded so far, in the order the API returned them. */
  payouts: PayoutHistory[];
  hasMorePayouts: boolean;
  fetchMorePayouts: () => Promise<void>;
  isLoading: boolean;
  isPayoutsLoading: boolean;
  isFetchingMorePayouts: boolean;
  error: string | null;
  payoutsError: string | null;
  /** False when no wallet is connected; queries are paused and data is cleared. */
  isWalletConnected: boolean;
  /** Refetches the summary and restarts payout history from the first page. */
  refreshEarnings: () => Promise<boolean>;
  isRefreshing: boolean;
  refreshError: string | null;
}

function messageOf(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : 'Something went wrong';
}

/**
 * useDriverEarnings — wallet balance and payout history for the signed-in driver.
 *
 * Follows the Component → Hook → Service pattern:
 *   Wallet components → useDriverEarnings → earningsService → /api/wallet/earnings
 *
 * Data is keyed by the connected wallet address. When the wallet disconnects the
 * queries pause and any cached earnings are removed, so a previous wallet's
 * balance is never shown.
 */
export function useDriverEarnings({
  pageSize = DEFAULT_PAYOUT_PAGE_SIZE,
}: UseDriverEarningsOptions = {}): UseDriverEarningsResult {
  const queryClient = useQueryClient();
  const address = useWalletStore((state) => state.address);
  const isConnected = useWalletStore((state) => state.isConnected);
  const isWalletConnected = isConnected && !!address;
  const walletKey = address ?? '';

  useEffect(() => {
    if (!isWalletConnected) {
      queryClient.removeQueries({ queryKey: driverEarningsKeys.all });
    }
  }, [isWalletConnected, queryClient]);

  const summaryQuery = useQuery({
    queryKey: driverEarningsKeys.summary(walletKey),
    queryFn: ({ signal }) => earningsService.getEarningsSummary(signal),
    enabled: isWalletConnected,
    staleTime: SUMMARY_STALE_MS,
  });

  const payoutsQuery = useInfiniteQuery({
    queryKey: driverEarningsKeys.payouts(walletKey, pageSize),
    queryFn: ({ pageParam, signal }) =>
      earningsService.getPayoutHistory({ cursor: pageParam, limit: pageSize }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isWalletConnected,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      if (!isWalletConnected) {
        throw new EarningsServiceError('Connect your wallet to refresh earnings.', null);
      }
      const [summary] = await Promise.all([
        earningsService.getEarningsSummary(),
        // Reset rather than refetch so stale cursors from older pages are discarded.
        queryClient.resetQueries({ queryKey: driverEarningsKeys.payouts(walletKey, pageSize) }),
      ]);
      return summary;
    },
    onSuccess: (summary) => {
      queryClient.setQueryData(driverEarningsKeys.summary(walletKey), summary);
    },
  });

  const { mutateAsync: refresh } = refreshMutation;
  const refreshEarnings = useCallback(async (): Promise<boolean> => {
    try {
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [refresh]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = payoutsQuery;
  const fetchMorePayouts = useCallback(async (): Promise<void> => {
    if (!hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const payouts = useMemo(
    () => payoutsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [payoutsQuery.data],
  );

  const summary = isWalletConnected ? (summaryQuery.data ?? null) : null;

  return {
    summary,
    available: summary?.available ?? 0,
    pending: summary?.pending ?? 0,
    total: summary?.total ?? 0,
    currency: summary?.currency ?? null,
    payouts: isWalletConnected ? payouts : [],
    hasMorePayouts: isWalletConnected && hasNextPage,
    fetchMorePayouts,
    isLoading: summaryQuery.isLoading,
    isPayoutsLoading: payoutsQuery.isLoading,
    isFetchingMorePayouts: isFetchingNextPage,
    error: isWalletConnected ? messageOf(summaryQuery.error) : null,
    payoutsError: isWalletConnected ? messageOf(payoutsQuery.error) : null,
    isWalletConnected,
    refreshEarnings,
    isRefreshing: refreshMutation.isPending,
    refreshError: messageOf(refreshMutation.error),
  };
}
