import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSettlementBreakdown } from '@/hooks/useSettlementBreakdown';
import {
  escrowSettlementService,
  SettlementServiceError,
} from '@/services/escrowSettlementService';
import {
  ESCROW_ID,
  SETTLEMENT_TX_HASH,
  confirmedSettlementResponse,
  failedSettlementResponse,
  finalizingSettlementResponse,
  pendingSettlementResponse,
} from './fixtures/settlementApiResponses';

jest.mock('@/services/escrowSettlementService', () => {
  const actual = jest.requireActual('@/services/escrowSettlementService');
  return {
    ...actual,
    escrowSettlementService: {
      ...actual.escrowSettlementService,
      getSettlement: jest.fn(),
    },
  };
});

const mockGetSettlement = escrowSettlementService.getSettlement as jest.MockedFunction<
  typeof escrowSettlementService.getSettlement
>;

const POLL_MS = 20;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retryDelay: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSettlementBreakdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns structured settlement data with formatted values', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.settlement).not.toBeNull());

    expect(mockGetSettlement).toHaveBeenCalledWith(ESCROW_ID, expect.any(AbortSignal));
    expect(result.current.settlement).toEqual(confirmedSettlementResponse);
    expect(result.current.formatted).toEqual({
      totalEscrowAmount: '1,250.00 XLM',
      driverPayout: '1,134.375 XLM',
      platformFee: '31.25 XLM',
      platformFeeRate: '2.5%',
      totalTaxWithheld: '59.375 XLM',
      heldAmount: '25.00 XLM',
      remainingBalance: '0.00 XLM',
    });
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isFinalizing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes a formatted tax breakdown', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.taxBreakdown).toHaveLength(2));
    expect(result.current.taxBreakdown[0]).toMatchObject({
      code: 'vat',
      formattedAmount: '2.34375 XLM',
      formattedRate: '7.5%',
    });
    expect(result.current.taxBreakdown[1]).toMatchObject({
      code: 'wht',
      formattedAmount: '57.03125 XLM',
      formattedRate: '5%',
    });
  });

  it('builds a Stellar explorer link for the settlement transaction', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.explorerUrl).not.toBeNull());
    expect(result.current.explorerUrl).toBe(
      `https://stellar.expert/explorer/testnet/tx/${SETTLEMENT_TX_HASH}`,
    );
  });

  it('returns a null explorer link while no transaction hash exists', async () => {
    mockGetSettlement.mockResolvedValue(pendingSettlementResponse);

    const { result } = renderHook(
      () => useSettlementBreakdown(ESCROW_ID, { pollIntervalMs: 60_000 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.settlement).not.toBeNull());
    expect(result.current.explorerUrl).toBeNull();
    expect(result.current.isFinalizing).toBe(true);
  });

  it('polls until the settlement reaches a terminal state', async () => {
    mockGetSettlement
      .mockResolvedValueOnce(pendingSettlementResponse)
      .mockResolvedValueOnce(finalizingSettlementResponse)
      .mockResolvedValue(confirmedSettlementResponse);

    const { result } = renderHook(
      () => useSettlementBreakdown(ESCROW_ID, { pollIntervalMs: POLL_MS }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.settlement?.status).toBe('confirmed'));
    expect(mockGetSettlement).toHaveBeenCalledTimes(3);
    expect(result.current.isTerminal).toBe(true);

    // No further requests once terminal.
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    expect(mockGetSettlement).toHaveBeenCalledTimes(3);
  });

  it('stops polling when the settlement fails', async () => {
    mockGetSettlement
      .mockResolvedValueOnce(finalizingSettlementResponse)
      .mockResolvedValue(failedSettlementResponse);

    const { result } = renderHook(
      () => useSettlementBreakdown(ESCROW_ID, { pollIntervalMs: POLL_MS }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.settlement?.status).toBe('failed'));
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    expect(mockGetSettlement).toHaveBeenCalledTimes(2);
    expect(result.current.isTerminal).toBe(true);
    expect(result.current.isFinalizing).toBe(false);
  });

  it('surfaces API errors without retrying client errors', async () => {
    mockGetSettlement.mockRejectedValue(
      new SettlementServiceError('Settlement not found for this escrow.', 404),
    );

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBe('Settlement not found for this escrow.'));
    expect(mockGetSettlement).toHaveBeenCalledTimes(1);
    expect(result.current.settlement).toBeNull();
    expect(result.current.formatted).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('retries server errors before reporting failure', async () => {
    mockGetSettlement.mockRejectedValue(
      new SettlementServiceError('Unable to load settlement details. Please try again.', 503),
    );

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(mockGetSettlement).toHaveBeenCalledTimes(3);
  });

  it('recovers after an error when refetch is called', async () => {
    mockGetSettlement
      .mockRejectedValueOnce(new SettlementServiceError('Bad request', 400))
      .mockResolvedValue(confirmedSettlementResponse);

    const { result } = renderHook(() => useSettlementBreakdown(ESCROW_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.error).toBe('Bad request'));

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.settlement).toEqual(confirmedSettlementResponse));
    expect(result.current.error).toBeNull();
  });

  it('does not fetch without an escrow id', () => {
    const { result } = renderHook(() => useSettlementBreakdown(undefined), {
      wrapper: createWrapper(),
    });

    expect(mockGetSettlement).not.toHaveBeenCalled();
    expect(result.current.settlement).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useSettlementBreakdown(ESCROW_ID, { enabled: false }), {
      wrapper: createWrapper(),
    });

    expect(mockGetSettlement).not.toHaveBeenCalled();
  });
});
