import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateDeliveryForm } from '@/features/deliveries/components/CreateDeliveryForm';
import { apiClient } from '@/services/api';

/**
 * End-to-end delivery creation workflow: real form, useCreateDelivery hook
 * (react-hook-form + zod + react-query) and deliveriesService. Only the HTTP
 * client and toast notifications are replaced.
 */

jest.mock('@/services/api', () => ({
  apiClient: { post: jest.fn(), get: jest.fn() },
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError }),
}));

const mockPost = apiClient.post as jest.Mock;

const validValues = {
  pickupAddress: '123 Main St, Lagos',
  destination: '456 Victoria Island, Lagos',
  description: 'Two boxes of electronics, handle with care',
  recipientName: 'John Doe',
  recipientPhone: '+234 801 234 5678',
  recipientEmail: 'john@example.com',
};

const renderForm = () => {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <CreateDeliveryForm />
    </QueryClientProvider>
  );
  return { invalidate };
};

/** Labels also contain the inline error text, so match on the label prefix. */
const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}`));

const submitButton = () =>
  screen.getByRole('button', { name: /submit delivery request|submitting/i });

const fillForm = async (
  user: ReturnType<typeof userEvent.setup>,
  overrides: Partial<typeof validValues> = {}
) => {
  const values = { ...validValues, ...overrides };
  const entries: [string, string][] = [
    ['Pickup Address', values.pickupAddress],
    ['Destination', values.destination],
    ['Description', values.description],
    ['Recipient Name', values.recipientName],
    ['Recipient Phone', values.recipientPhone],
    ['Recipient Email', values.recipientEmail],
  ];
  for (const [label, value] of entries) {
    if (value) await user.type(field(label), value);
  }
};

describe('Delivery creation workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts with an empty form, "small" package size and a disabled submit button', () => {
    renderForm();

    expect(field('Pickup Address')).toHaveValue('');
    expect(field('Package Size')).toHaveValue('small');
    expect(submitButton()).toBeDisabled();
  });

  it('enables submit only once every required field is valid', async () => {
    const user = userEvent.setup();
    renderForm();

    await fillForm(user, { recipientEmail: '' });
    expect(submitButton()).toBeDisabled();

    await user.type(field('Recipient Email'), 'john@example.com');

    await waitFor(() => expect(submitButton()).toBeEnabled());
  });

  it('submits a completed request, invalidates the deliveries list and resets the form', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ data: { id: 'del-1' } });
    const { invalidate } = renderForm();

    await fillForm(user);
    await user.selectOptions(field('Package Size'), 'large');
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith('/deliveries', {
      ...validValues,
      packageSize: 'large',
    });
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Delivery request sent',
        'Your logistics request was created successfully.'
      )
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deliveries'] });
    await waitFor(() =>
      expect(field('Pickup Address')).toHaveValue('')
    );
    expect(field('Package Size')).toHaveValue('small');
    expect(
      screen.getByText(/delivery request has been submitted successfully/i)
    ).toBeInTheDocument();
  });

  it('shows the in-flight state and blocks duplicate submissions', async () => {
    const user = userEvent.setup();
    let resolvePost: (value: unknown) => void = () => {};
    mockPost.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      })
    );
    renderForm();

    await fillForm(user);
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    const pending = await screen.findByRole('button', {
      name: /submitting request/i,
    });
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(mockPost).toHaveBeenCalledTimes(1);

    resolvePost({ data: { id: 'del-1' } });

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
  });

  it('reports an API failure, keeps the entered data and allows a retry', async () => {
    const user = userEvent.setup();
    mockPost
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce({ data: { id: 'del-2' } });
    renderForm();

    await fillForm(user);
    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'Unable to create delivery request',
        'Server unavailable'
      )
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(field('Pickup Address')).toHaveValue(
      validValues.pickupAddress
    );
    expect(
      screen.queryByText(/submitted successfully/i)
    ).not.toBeInTheDocument();

    await waitFor(() => expect(submitButton()).toBeEnabled());
    await user.click(submitButton());

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['pickupAddress', 'Pickup Address', 'abc', 'Pickup address is required'],
    ['destination', 'Destination', 'abc', 'Destination address is required'],
    ['description', 'Description', 'too short', 'Package description is required'],
    ['recipientName', 'Recipient Name', 'J', 'Recipient name is required'],
    ['recipientPhone', 'Recipient Phone', '12', 'Recipient phone is required'],
    ['recipientPhone', 'Recipient Phone', 'call-me-maybe', 'Enter a valid phone number'],
    ['recipientEmail', 'Recipient Email', 'not-an-email', 'Enter a valid recipient email'],
  ])('shows a validation message for invalid %s (%s)', async (_field, label, value, message) => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field(label), value);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(field(label)).toHaveAttribute('aria-invalid', 'true');
    expect(submitButton()).toBeDisabled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('rejects an over-long pickup address and clears the error when shortened', async () => {
    const user = userEvent.setup();
    renderForm();
    const pickup = field('Pickup Address');

    await user.click(pickup);
    await user.paste('a'.repeat(251));
    expect(
      await screen.findByText('Pickup address must be under 250 characters')
    ).toBeInTheDocument();

    await user.clear(pickup);
    await user.paste('123 Main St, Lagos');

    await waitFor(() =>
      expect(
        screen.queryByText('Pickup address must be under 250 characters')
      ).not.toBeInTheDocument()
    );
  });

  it.each(['small', 'medium', 'large'])(
    'sends the selected package size "%s" to the API',
    async (size) => {
      const user = userEvent.setup();
      mockPost.mockResolvedValue({ data: { id: 'del-x' } });
      renderForm();

      await fillForm(user);
      await user.selectOptions(field('Package Size'), size);
      await waitFor(() => expect(submitButton()).toBeEnabled());
      await user.click(submitButton());

      await waitFor(() =>
        expect(mockPost).toHaveBeenCalledWith(
          '/deliveries',
          expect.objectContaining({ packageSize: size })
        )
      );
    }
  );
});
