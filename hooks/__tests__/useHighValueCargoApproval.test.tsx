import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useHighValueCargoApproval } from '@/hooks/useHighValueCargoApproval';
import {
  CargoApprovalServiceError,
  cargoApprovalService,
} from '@/services/cargoApprovalService';
import { freighterService } from '@/services/freighterService';
import { useWalletStore } from '@/store/walletStore';
import {
  NON_SIGNER,
  SIGNER_FLEET_MANAGER,
  SIGNER_INSURER,
  SIGNER_SHIPPER,
  expiredApprovalFixture,
  pendingApprovalFixture,
  thresholdMetApprovalFixture,
} from './fixtures/cargoApprovalApiResponses';

jest.mock('@/services/cargoApprovalService', () => {
  const actual = jest.requireActual('@/services/cargoApprovalService');
  return {
    ...actual,
    cargoApprovalService: {
      getApproval: jest.fn(),
      submitSignature: jest.fn(),
    },
  };
});

jest.mock('@/services/freighterService', () => ({
  freighterService: {
    getPublicKey: jest.fn(),
    signTransaction: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockGetApproval = cargoApprovalService.getApproval as jest.Mock;
const mockSubmitSignature = cargoApprovalService.submitSignature as jest.Mock;
const mockGetPublicKey = freighterService.getPublicKey as jest.Mock;
const mockSignTransaction = freighterService.signTransaction as jest.Mock;

const ESCROW_ID = 'escrow-hv-001';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function connectAs(address: string) {
  act(() => {
    useWalletStore.getState().setWallet(address, 0);
  });
}

async function renderLoaded() {
  const hook = renderHook(() => useHighValueCargoApproval(ESCROW_ID), {
    wrapper: createWrapper(),
  });
  await waitFor(() => expect(hook.result.current.approval).not.toBeNull());
  return hook;
}

describe('useHighValueCargoApproval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    act(() => {
      useWalletStore.getState().clearWalletState();
    });
    mockGetApproval.mockResolvedValue(pendingApprovalFixture);
    mockGetPublicKey.mockResolvedValue(SIGNER_SHIPPER);
    mockSignTransaction.mockResolvedValue('signed-xdr');
    mockSubmitSignature.mockResolvedValue(thresholdMetApprovalFixture);
  });

  describe('signer resolution', () => {
    it('fetches the approval for the escrow and tracks loading', async () => {
      const { result } = renderHook(() => useHighValueCargoApproval(ESCROW_ID), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockGetApproval).toHaveBeenCalledWith(ESCROW_ID, expect.any(AbortSignal));
    });

    it('returns every signer with weight and approved status', async () => {
      connectAs(SIGNER_SHIPPER);
      const { result } = await renderLoaded();

      expect(result.current.signers).toEqual([
        expect.objectContaining({ publicKey: SIGNER_FLEET_MANAGER, weight: 2, approved: true }),
        expect.objectContaining({
          publicKey: SIGNER_SHIPPER,
          weight: 1,
          approved: false,
          isCurrentUser: true,
        }),
        expect.objectContaining({ publicKey: SIGNER_INSURER, weight: 1, approved: false }),
      ]);
    });

    it('does not query without an escrow id', () => {
      renderHook(() => useHighValueCargoApproval(''), { wrapper: createWrapper() });
      expect(mockGetApproval).not.toHaveBeenCalled();
    });

    it('exposes load errors', async () => {
      mockGetApproval.mockRejectedValue(new Error('Unable to load approval details.'));
      const { result } = renderHook(() => useHighValueCargoApproval(ESCROW_ID), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBe('Unable to load approval details.'));
      expect(result.current.canSign).toBe(false);
    });
  });

  describe('threshold verification', () => {
    it('sums signed weights rather than counting signatures', async () => {
      const { result } = await renderLoaded();

      expect(result.current.threshold).toBe(3);
      expect(result.current.currentWeight).toBe(2);
      expect(result.current.signatureCount).toBe(1);
      expect(result.current.isThresholdMet).toBe(false);
    });

    it('is met once the combined weight reaches the threshold', async () => {
      mockGetApproval.mockResolvedValue({ ...thresholdMetApprovalFixture, status: 'pending' });
      const { result } = await renderLoaded();

      expect(result.current.currentWeight).toBe(3);
      expect(result.current.isThresholdMet).toBe(true);
    });

    it('is not met for a zero threshold with no signatures', async () => {
      mockGetApproval.mockResolvedValue({
        ...pendingApprovalFixture,
        threshold: 0,
        signers: pendingApprovalFixture.signers.map((s) => ({ ...s, hasSigned: false })),
      });
      const { result } = await renderLoaded();

      expect(result.current.isThresholdMet).toBe(false);
    });

    it('trusts a threshold_met status from the escrow service', async () => {
      mockGetApproval.mockResolvedValue({ ...pendingApprovalFixture, status: 'threshold_met' });
      const { result } = await renderLoaded();

      expect(result.current.isThresholdMet).toBe(true);
    });
  });

  describe('signer authorization', () => {
    it('allows an authorized signer who has not signed', async () => {
      connectAs(SIGNER_SHIPPER);
      const { result } = await renderLoaded();

      expect(result.current.isAuthorizedSigner).toBe(true);
      expect(result.current.hasSigned).toBe(false);
      expect(result.current.canSign).toBe(true);
      expect(result.current.signBlockedReason).toBeNull();
    });

    it('blocks a wallet that is not in the signer set', async () => {
      connectAs(NON_SIGNER);
      const { result } = await renderLoaded();

      expect(result.current.isAuthorizedSigner).toBe(false);
      expect(result.current.canSign).toBe(false);
      expect(result.current.signBlockedReason).toBe('unauthorized');

      let ok = true;
      await act(async () => {
        ok = await result.current.sign();
      });
      expect(ok).toBe(false);
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'Your wallet is not an authorized signer for this cargo.',
      );
    });

    it('blocks signing without a connected wallet', async () => {
      const { result } = await renderLoaded();

      expect(result.current.signBlockedReason).toBe('wallet_disconnected');
      expect(result.current.canSign).toBe(false);
    });

    it('rejects a Freighter account that differs from the connected wallet', async () => {
      connectAs(SIGNER_SHIPPER);
      mockGetPublicKey.mockResolvedValue(SIGNER_INSURER);
      const { result } = await renderLoaded();

      let ok = true;
      await act(async () => {
        ok = await result.current.sign();
      });

      expect(ok).toBe(false);
      expect(mockSignTransaction).not.toHaveBeenCalled();
      expect(mockSubmitSignature).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        'The Freighter account does not match your connected wallet.',
      );
    });
  });

  describe('signing', () => {
    it('signs the envelope with Freighter, submits it and applies the new state', async () => {
      connectAs(SIGNER_SHIPPER);
      const { result } = await renderLoaded();

      let ok = false;
      await act(async () => {
        ok = await result.current.sign();
      });

      expect(ok).toBe(true);
      expect(mockSignTransaction).toHaveBeenCalledWith(pendingApprovalFixture.transactionXdr);
      expect(mockSubmitSignature).toHaveBeenCalledWith(ESCROW_ID, {
        signerPublicKey: SIGNER_SHIPPER,
        signedTransactionXdr: 'signed-xdr',
      });
      await waitFor(() => expect(result.current.isThresholdMet).toBe(true));
      expect(result.current.hasSigned).toBe(true);
      expect(result.current.canSign).toBe(false);
      expect(toast.success).toHaveBeenCalledWith('Signature recorded');
    });

    it('surfaces a rejected Freighter prompt as a sign error', async () => {
      connectAs(SIGNER_SHIPPER);
      mockSignTransaction.mockRejectedValue(new Error('User declined access'));
      const { result } = await renderLoaded();

      await act(async () => {
        await result.current.sign();
      });

      await waitFor(() => expect(result.current.signError).toBe('User declined access'));
      expect(mockSubmitSignature).not.toHaveBeenCalled();
    });
  });

  describe('already-signed state', () => {
    it('reports hasSigned and blocks a second signature', async () => {
      connectAs(SIGNER_FLEET_MANAGER);
      const { result } = await renderLoaded();

      expect(result.current.hasSigned).toBe(true);
      expect(result.current.signBlockedReason).toBe('already_signed');

      let ok = true;
      await act(async () => {
        ok = await result.current.sign();
      });
      expect(ok).toBe(false);
      expect(mockGetPublicKey).not.toHaveBeenCalled();
    });

    it('resyncs when the backend reports the signature already exists', async () => {
      connectAs(SIGNER_SHIPPER);
      mockSubmitSignature.mockRejectedValue(
        new CargoApprovalServiceError('Signature already recorded', 409),
      );
      const { result } = await renderLoaded();
      mockGetApproval.mockResolvedValue(thresholdMetApprovalFixture);

      await act(async () => {
        await result.current.sign();
      });

      expect(toast.info).toHaveBeenCalledWith('You have already signed this approval.');
      await waitFor(() => expect(result.current.hasSigned).toBe(true));
    });
  });

  describe('expired approval windows', () => {
    it('blocks signing when the service reports the window expired', async () => {
      connectAs(SIGNER_SHIPPER);
      mockGetApproval.mockResolvedValue(expiredApprovalFixture);
      const { result } = await renderLoaded();

      expect(result.current.isExpired).toBe(true);
      expect(result.current.signBlockedReason).toBe('expired');
      expect(result.current.canSign).toBe(false);
    });

    it('treats a past deadline as expired even if the status is stale', async () => {
      connectAs(SIGNER_SHIPPER);
      mockGetApproval.mockResolvedValue({
        ...pendingApprovalFixture,
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      const { result } = await renderLoaded();

      expect(result.current.isExpired).toBe(true);
      expect(result.current.canSign).toBe(false);
    });

    it('expires while the view is open when the deadline passes', async () => {
      connectAs(SIGNER_SHIPPER);
      mockGetApproval.mockResolvedValue({
        ...pendingApprovalFixture,
        expiresAt: new Date(Date.now() + 150).toISOString(),
      });
      const { result } = await renderLoaded();

      expect(result.current.isExpired).toBe(false);
      expect(result.current.canSign).toBe(true);
      await waitFor(() => expect(result.current.isExpired).toBe(true));
      expect(result.current.signBlockedReason).toBe('expired');
    });

    it('handles the backend rejecting a signature for an expired window', async () => {
      connectAs(SIGNER_SHIPPER);
      mockSubmitSignature.mockRejectedValue(
        new CargoApprovalServiceError('Approval window closed', 410),
      );
      const { result } = await renderLoaded();
      mockGetApproval.mockResolvedValue(expiredApprovalFixture);

      let ok = true;
      await act(async () => {
        ok = await result.current.sign();
      });

      expect(ok).toBe(false);
      expect(toast.error).toHaveBeenCalledWith('This approval window has expired.');
      await waitFor(() => expect(result.current.isExpired).toBe(true));
    });
  });
});
