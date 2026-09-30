import React, { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HighValueCargoMultiSigModal } from '@/components/escrow/HighValueCargoMultiSigModal';
import {
  highValueCargoService,
  HighValueCargoServiceError,
} from '@/services/highValueCargoService';
import {
  FIXED_NOW,
  SHIPMENT_ID,
  awaitingApprovalResponse,
  domesticApprovalResponse,
  expiredApprovalResponse,
  readyApprovalResponse,
  submitApprovalResponse,
} from '@/hooks/__tests__/fixtures/highValueCargoApiResponses';

jest.mock('@/services/highValueCargoService', () => {
  const actual = jest.requireActual('@/services/highValueCargoService');
  return {
    ...actual,
    highValueCargoService: { getApproval: jest.fn(), submitApproval: jest.fn() },
  };
});

const mockGetApproval = highValueCargoService.getApproval as jest.MockedFunction<
  typeof highValueCargoService.getApproval
>;
const mockSubmitApproval = highValueCargoService.submitApproval as jest.MockedFunction<
  typeof highValueCargoService.submitApproval
>;

function renderModal(props: Partial<React.ComponentProps<typeof HighValueCargoMultiSigModal>> = {}) {
  const onClose = jest.fn();
  const onSubmitted = jest.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <HighValueCargoMultiSigModal
        shipmentId={SHIPMENT_ID}
        isOpen
        onClose={onClose}
        onSubmitted={onSubmitted}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onSubmitted };
}

async function findDialog() {
  const dialog = await screen.findByRole('dialog', { name: 'High-value cargo approval' });
  await within(dialog).findByText('Shipment value');
  return dialog;
}

describe('HighValueCargoMultiSigModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when closed and does not fetch', () => {
    renderModal({ isOpen: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockGetApproval).not.toHaveBeenCalled();
  });

  it('shows a loading state while fetching', () => {
    mockGetApproval.mockReturnValue(new Promise(() => {}));
    renderModal();

    expect(screen.getByTestId('multisig-modal-loading')).toBeInTheDocument();
  });

  it('renders into a portal on document.body as a modal dialog', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    const { container } = renderModal();

    const dialog = await findDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });

  it('displays shipment value and risk classification', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    const dialog = await findDialog();
    expect(within(dialog).getByText('$185,000.00')).toBeInTheDocument();
    expect(within(dialog).getByText('High risk')).toBeInTheDocument();
    const factors = within(dialog).getByRole('list', { name: 'Risk factors' });
    expect(within(factors).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the risk warning banner for cross-border shipments', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    const banner = await screen.findByRole('note', { name: 'Cross-border risk warning' });
    expect(banner).toHaveTextContent('Nigeria → Ghana');
  });

  it('hides the cross-border banner for domestic shipments', async () => {
    mockGetApproval.mockResolvedValue(domesticApprovalResponse);
    renderModal();

    await findDialog();
    expect(screen.queryByRole('note', { name: 'Cross-border risk warning' })).not.toBeInTheDocument();
    expect(screen.getByText('Critical risk')).toBeInTheDocument();
  });

  it('lists all required signers with their approval status', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    await findDialog();
    const signers = within(screen.getByRole('list', { name: 'Required signers' })).getAllByRole('listitem');
    expect(signers).toHaveLength(3);
    expect(signers[0]).toHaveTextContent('Adaeze Okafor');
    expect(signers[0]).toHaveTextContent('Approved');
    expect(signers[1]).toHaveTextContent('Kwame Mensah');
    expect(signers[1]).toHaveTextContent('Pending');
  });

  it('shows approval progress as current/required signatures', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    await findDialog();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Signature progress' })).toBeInTheDocument();
  });

  it('shows a countdown to the approval deadline', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    await findDialog();
    expect(screen.getByRole('timer')).toHaveTextContent('02:30:15');
  });

  it('keeps submit disabled until all signatures are collected, even when acknowledged', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    await findDialog();
    await userEvent.click(screen.getByRole('checkbox'));

    const submit = screen.getByRole('button', { name: 'Approve release' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription('Waiting for 2 more signatures.');
  });

  it('requires the high-risk acknowledgement once all signatures are collected', async () => {
    mockGetApproval.mockResolvedValue(readyApprovalResponse);
    renderModal();

    await findDialog();
    const submit = screen.getByRole('button', { name: 'Approve release' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription('Acknowledge the high-risk status to continue.');

    await userEvent.click(screen.getByRole('checkbox', { name: /i acknowledge/i }));
    expect(submit).toBeEnabled();
  });

  it('submits the approval and notifies the caller', async () => {
    mockGetApproval.mockResolvedValue(readyApprovalResponse);
    mockSubmitApproval.mockResolvedValue(submitApprovalResponse);
    const { onSubmitted } = renderModal();

    await findDialog();
    await userEvent.click(screen.getByRole('checkbox', { name: /i acknowledge/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve release' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submitApprovalResponse));
    expect(mockSubmitApproval).toHaveBeenCalledWith(SHIPMENT_ID, { acknowledgedHighRisk: true });
  });

  it('shows the submission error from the API', async () => {
    mockGetApproval.mockResolvedValue(readyApprovalResponse);
    mockSubmitApproval.mockRejectedValue(
      new HighValueCargoServiceError('Signature threshold not met on-chain', 409),
    );
    renderModal();

    await findDialog();
    await userEvent.click(screen.getByRole('checkbox', { name: /i acknowledge/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve release' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Signature threshold not met on-chain');
  });

  it('blocks submission once the approval window has expired', async () => {
    mockGetApproval.mockResolvedValue(expiredApprovalResponse);
    renderModal();

    await findDialog();
    expect(screen.getByText('Approval window expired')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve release' })).toHaveAccessibleDescription(
      'The approval window has expired.',
    );
  });

  it('closes on Escape', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    const { onClose } = renderModal();

    await findDialog();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and backdrop', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    const { onClose } = renderModal();

    await findDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Close approval modal' }));
    await userEvent.click(screen.getByTestId('multisig-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps focus inside the dialog', async () => {
    mockGetApproval.mockResolvedValue(readyApprovalResponse);
    renderModal();

    const dialog = await findDialog();
    expect(dialog).toHaveFocus();

    const closeButton = screen.getByRole('button', { name: 'Close approval modal' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });

    await userEvent.tab();
    expect(closeButton).toHaveFocus();

    // Submit is disabled until acknowledged, so Cancel is the last focusable element.
    cancelButton.focus();
    await userEvent.tab();
    expect(closeButton).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it('restores focus to the trigger when closed', async () => {
    mockGetApproval.mockResolvedValue(awaitingApprovalResponse);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <QueryClientProvider client={queryClient}>
          <button type="button" onClick={() => setOpen(true)}>
            Review approval
          </button>
          <HighValueCargoMultiSigModal shipmentId={SHIPMENT_ID} isOpen={open} onClose={() => setOpen(false)} />
        </QueryClientProvider>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Review approval' });
    await userEvent.click(trigger);
    await findDialog();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('shows an error with retry when approval details fail to load', async () => {
    mockGetApproval
      .mockRejectedValueOnce(new HighValueCargoServiceError('Shipment is not flagged as high value', 404))
      .mockResolvedValue(awaitingApprovalResponse);
    renderModal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Shipment is not flagged as high value');

    await userEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await findDialog();
    expect(screen.getByText('$185,000.00')).toBeInTheDocument();
  });
});
