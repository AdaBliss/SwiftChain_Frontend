import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettlementConfirmation } from '@/components/escrow/SettlementConfirmation';
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
} from '@/hooks/__tests__/fixtures/settlementApiResponses';

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

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettlementConfirmation escrowId={ESCROW_ID} />
    </QueryClientProvider>,
  );
}

function breakdownRow(label: RegExp) {
  const term = screen.getByText(label).closest('div') as HTMLElement;
  return within(term.parentElement as HTMLElement);
}

describe('SettlementConfirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading skeleton while fetching', () => {
    mockGetSettlement.mockReturnValue(new Promise(() => {}));
    renderScreen();

    expect(screen.getByTestId('settlement-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the success header and amount released to the driver', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Settlement complete' })).toBeInTheDocument();
    expect(screen.getByTestId('driver-payout')).toHaveTextContent('1,134.375 XLM');
    expect(mockGetSettlement).toHaveBeenCalledWith(ESCROW_ID, expect.any(AbortSignal));
  });

  it('renders the fund breakdown from the settlement values', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    await screen.findByRole('heading', { name: 'Settlement complete' });

    expect(breakdownRow(/Total escrow amount/).getByText('1,250.00 XLM')).toBeInTheDocument();
    expect(breakdownRow(/Platform commission \(2\.5%\)/).getByText('31.25 XLM')).toBeInTheDocument();
    expect(breakdownRow(/VAT on platform fee \(7\.5%\)/).getByText('2.34375 XLM')).toBeInTheDocument();
    expect(breakdownRow(/Withholding tax \(5%\)/).getByText('57.03125 XLM')).toBeInTheDocument();
    expect(breakdownRow(/Remaining balance/).getByText('0.00 XLM')).toBeInTheDocument();
  });

  it('shows held amounts with the reason', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    await screen.findByRole('heading', { name: 'Settlement complete' });

    expect(screen.getByText('Pending / held')).toBeInTheDocument();
    expect(screen.getByText('25.00 XLM')).toBeInTheDocument();
    expect(screen.getByText('Dispute window open for 24 hours')).toBeInTheDocument();
  });

  it('hides the held row when nothing is held', async () => {
    mockGetSettlement.mockResolvedValue({ ...confirmedSettlementResponse, heldAmount: 0, heldReason: null });
    renderScreen();

    await screen.findByRole('heading', { name: 'Settlement complete' });
    expect(screen.queryByText('Pending / held')).not.toBeInTheDocument();
  });

  it('links the transaction hash to the Stellar explorer', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    const link = await screen.findByRole('link', { name: /view on stellar explorer/i });
    expect(link).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/tx/${SETTLEMENT_TX_HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTitle(SETTLEMENT_TX_HASH)).toBeInTheDocument();
    expect(screen.getByText('51234567')).toBeInTheDocument();
  });

  it('renders the delivery summary', async () => {
    mockGetSettlement.mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    await screen.findByRole('heading', { name: 'Settlement complete' });

    expect(screen.getByText('SWC-2026-004821')).toBeInTheDocument();
    expect(screen.getByText('Lagos, NG')).toBeInTheDocument();
    expect(screen.getByText('Accra, GH')).toBeInTheDocument();
    expect(screen.getByText('Sep 28, 2026, 1:58 PM UTC')).toBeInTheDocument();
  });

  it('shows a finalizing notice while the transaction is confirming', async () => {
    mockGetSettlement.mockResolvedValue(finalizingSettlementResponse);
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Finalizing settlement' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/updates automatically/i);
  });

  it('explains the missing hash before the transaction is submitted', async () => {
    mockGetSettlement.mockResolvedValue(pendingSettlementResponse);
    renderScreen();

    await screen.findByRole('heading', { name: 'Finalizing settlement' });
    expect(screen.queryByRole('link', { name: /view on stellar explorer/i })).not.toBeInTheDocument();
    expect(screen.getByText(/transaction hash will appear once submitted/i)).toBeInTheDocument();
  });

  it('renders the failed state', async () => {
    mockGetSettlement.mockResolvedValue(failedSettlementResponse);
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Settlement failed' })).toBeInTheDocument();
    expect(screen.getByText('Driver payout (not released)')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an error with retry when the API fails', async () => {
    mockGetSettlement
      .mockRejectedValueOnce(new SettlementServiceError('Settlement not found for this escrow.', 404))
      .mockResolvedValue(confirmedSettlementResponse);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Settlement not found for this escrow.');

    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Settlement complete' })).toBeInTheDocument(),
    );
  });
});
