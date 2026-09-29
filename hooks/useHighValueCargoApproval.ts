'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CargoApprovalServiceError,
  cargoApprovalService,
} from '@/services/cargoApprovalService';
import { freighterService } from '@/services/freighterService';
import { useWalletStore } from '@/store/walletStore';
import type { CargoApproval } from '@/types/cargoApproval';

/** Poll while co-signers are still signing so progress stays current. */
export const APPROVAL_POLL_INTERVAL_MS = 15_000;
/** setTimeout overflows above this delay (about 24.8 days). */
const MAX_TIMEOUT_MS = 2_147_483_647;

export const cargoApprovalKeys = {
  approval: (escrowId: string) => ['highValueCargoApproval', escrowId] as const,
};

export interface ApprovalSigner {
  publicKey: string;
  weight: number;
  approved: boolean;
  signedAt: string | null;
  label?: string;
  /** True when this signer is the connected wallet. */
  isCurrentUser: boolean;
}

export type SignBlockedReason =
  | 'loading'
  | 'wallet_disconnected'
  | 'unauthorized'
  | 'already_signed'
  | 'threshold_met'
  | 'expired'
  | 'closed';

export interface UseHighValueCargoApprovalResult {
  approval: CargoApproval | null;
  signers: ApprovalSigner[];
  threshold: number;
  /** Combined weight of the signatures collected so far. */
  currentWeight: number;
  signatureCount: number;
  isThresholdMet: boolean;
  isExpired: boolean;
  isAuthorizedSigner: boolean;
  hasSigned: boolean;
  canSign: boolean;
  /** Why signing is unavailable, or null when the user can sign. */
  signBlockedReason: SignBlockedReason | null;
  sign: () => Promise<boolean>;
  isSigning: boolean;
  signError: string | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const BLOCKED_MESSAGES: Record<SignBlockedReason, string> = {
  loading: 'Approval details are still loading.',
  wallet_disconnected: 'Connect your wallet to sign this approval.',
  unauthorized: 'Your wallet is not an authorized signer for this cargo.',
  already_signed: 'You have already signed this approval.',
  threshold_met: 'The approval threshold has already been met.',
  expired: 'This approval window has expired.',
  closed: 'This approval is no longer accepting signatures.',
};

/**
 * Tracks wall-clock time just precisely enough to flip `isExpired` at the
 * deadline, using a single timer instead of a ticking interval.
 */
function useDeadlinePassed(deadlineMs: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadlineMs === null || deadlineMs <= now) return;
    const delay = Math.min(Math.max(deadlineMs - Date.now(), 0), MAX_TIMEOUT_MS);
    const id = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(id);
  }, [deadlineMs, now]);

  return deadlineMs !== null && deadlineMs <= now;
}

/**
 * useHighValueCargoApproval — multi-signature approval flow for high-value cargo.
 *
 * Follows the Component → Hook → Service pattern:
 *   Approval UI → useHighValueCargoApproval → cargoApprovalService / freighterService
 *
 * Resolves the signer set and weights from the escrow API, verifies the
 * connected wallet is an authorized signer that has not yet signed, collects
 * its signature through Freighter and reports whether the weighted threshold
 * is met. Expired approval windows block signing, both when the backend
 * reports them and when the deadline passes while the view is open.
 */
export function useHighValueCargoApproval(escrowId: string): UseHighValueCargoApprovalResult {
  const queryClient = useQueryClient();
  const walletAddress = useWalletStore((state) => state.address);
  const isConnected = useWalletStore((state) => state.isConnected);
  const queryKey = cargoApprovalKeys.approval(escrowId);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => cargoApprovalService.getApproval(escrowId, signal),
    enabled: !!escrowId,
    refetchInterval: (q) =>
      q.state.data?.status === 'pending' ? APPROVAL_POLL_INTERVAL_MS : false,
  });

  const approval = query.data ?? null;
  const deadlineMs = approval ? Date.parse(approval.expiresAt) : null;
  const deadlinePassed = useDeadlinePassed(
    deadlineMs !== null && Number.isFinite(deadlineMs) ? deadlineMs : null,
  );

  const signers = useMemo<ApprovalSigner[]>(
    () =>
      (approval?.signers ?? []).map((signer) => ({
        publicKey: signer.publicKey,
        weight: signer.weight,
        approved: signer.hasSigned,
        signedAt: signer.signedAt,
        label: signer.label,
        isCurrentUser: isConnected && signer.publicKey === walletAddress,
      })),
    [approval, isConnected, walletAddress],
  );

  const threshold = approval?.threshold ?? 0;
  const currentWeight = signers.reduce((sum, s) => (s.approved ? sum + s.weight : sum), 0);
  const signatureCount = signers.filter((s) => s.approved).length;
  const isThresholdMet =
    !!approval &&
    (approval.status === 'threshold_met' ||
      approval.status === 'executed' ||
      (threshold > 0 && currentWeight >= threshold));
  const isExpired = !!approval && (approval.status === 'expired' || deadlinePassed);

  const currentSigner = signers.find((s) => s.isCurrentUser);
  const isAuthorizedSigner = !!currentSigner;
  const hasSigned = !!currentSigner?.approved;

  let signBlockedReason: SignBlockedReason | null = null;
  if (!approval) signBlockedReason = 'loading';
  else if (!isConnected || !walletAddress) signBlockedReason = 'wallet_disconnected';
  else if (isExpired) signBlockedReason = 'expired';
  else if (!isAuthorizedSigner) signBlockedReason = 'unauthorized';
  else if (hasSigned) signBlockedReason = 'already_signed';
  else if (isThresholdMet) signBlockedReason = 'threshold_met';
  else if (approval.status !== 'pending') signBlockedReason = 'closed';

  const mutation = useMutation({
    mutationFn: async (current: CargoApproval) => {
      const publicKey = await freighterService.getPublicKey();
      if (publicKey !== walletAddress) {
        throw new CargoApprovalServiceError(
          'The Freighter account does not match your connected wallet.',
          null,
        );
      }
      const signedTransactionXdr = await freighterService.signTransaction(current.transactionXdr);
      return cargoApprovalService.submitSignature(escrowId, {
        signerPublicKey: publicKey,
        signedTransactionXdr,
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
      toast.success('Signature recorded');
    },
    onError: (err: Error) => {
      if (err instanceof CargoApprovalServiceError && err.code === 'already_signed') {
        toast.info(BLOCKED_MESSAGES.already_signed);
      } else if (err instanceof CargoApprovalServiceError && err.code === 'expired') {
        toast.error(BLOCKED_MESSAGES.expired);
      } else {
        toast.error(err.message || 'Failed to sign approval');
      }
      // The server state moved on (new signature, expiry, signer change); resync.
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutateAsync, isPending } = mutation;
  const sign = useCallback(async (): Promise<boolean> => {
    if (isPending) return false;
    if (signBlockedReason || !approval) {
      toast.error(BLOCKED_MESSAGES[signBlockedReason ?? 'loading']);
      return false;
    }
    try {
      await mutateAsync(approval);
      return true;
    } catch {
      return false;
    }
  }, [approval, isPending, mutateAsync, signBlockedReason]);

  const { refetch: refetchQuery } = query;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);

  return {
    approval,
    signers,
    threshold,
    currentWeight,
    signatureCount,
    isThresholdMet,
    isExpired,
    isAuthorizedSigner,
    hasSigned,
    canSign: signBlockedReason === null && !isPending,
    signBlockedReason,
    sign,
    isSigning: isPending,
    signError: mutation.error ? mutation.error.message : null,
    isLoading: query.isLoading,
    error: query.error ? query.error.message : null,
    refetch,
  };
}
