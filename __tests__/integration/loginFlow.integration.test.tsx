import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '@/app/(auth)/login/page';
import httpClient from '@/lib/httpClient';

/**
 * End-to-end login flow, from the login screen to the dashboard redirect.
 * The real page, LoginForm, useLogin hook and authService are exercised
 * together; only the HTTP client and the Next router are replaced.
 */

jest.mock('@/lib/httpClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockPost = httpClient.post as jest.Mock;

const fillAndSubmit = async (
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password: string
) => {
  if (email) await user.type(screen.getByLabelText(/email address/i), email);
  if (password) await user.type(screen.getByLabelText(/^password/i), password);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
};

describe('Login flow: login screen to dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('renders the login screen with its fields and navigation links', () => {
    render(<LoginPage />);

    expect(
      screen.getByRole('heading', { name: /sign in/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password'
    );
    expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute(
      'href',
      '/register'
    );
  });

  it('logs in with valid credentials, stores the token and redirects to the dashboard', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        data: {
          token: 'jwt-token-123',
          user: {
            id: 'u1',
            email: 'ada@example.com',
            name: 'Ada',
            role: 'customer',
          },
        },
      },
    });
    render(<LoginPage />);

    await fillAndSubmit(user, 'ada@example.com', 'Secret123!');

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login'),
      { email: 'ada@example.com', password: 'Secret123!' }
    );
    expect(localStorage.getItem('authToken')).toBe('jwt-token-123');
  });

  it('disables the submit button and shows progress while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolveLogin: (value: unknown) => void = () => {};
    mockPost.mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      })
    );
    render(<LoginPage />);

    await fillAndSubmit(user, 'ada@example.com', 'Secret123!');

    const pending = await screen.findByRole('button', { name: /signing in/i });
    expect(pending).toBeDisabled();
    expect(mockPush).not.toHaveBeenCalled();

    resolveLogin({
      data: { success: true, data: { token: 't', user: {} } },
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('blocks submission and shows field errors when the form is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before calling the API', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await fillAndSubmit(user, 'not-an-email', 'Secret123!');

    expect(
      await screen.findByText('Please enter a valid email address')
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('validates a field on blur and clears the error once the user fixes it', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const email = screen.getByLabelText(/email address/i);
    await user.click(email);
    await user.tab();
    expect(await screen.findByText('Email is required')).toBeInTheDocument();

    await user.type(email, 'ada@example.com');

    await waitFor(() =>
      expect(screen.queryByText('Email is required')).not.toBeInTheDocument()
    );
  });

  it('does not store a token or redirect when the API reports failure', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({
      data: { success: false, message: 'Invalid credentials' },
    });
    render(<LoginPage />);

    await fillAndSubmit(user, 'ada@example.com', 'wrong-password');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('does not redirect when a successful response carries no token', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ data: { success: true, data: {} } });
    render(<LoginPage />);

    await fillAndSubmit(user, 'ada@example.com', 'Secret123!');

    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(localStorage.getItem('authToken')).toBeNull();
  });

  it('recovers from a network error and allows a successful retry', async () => {
    const user = userEvent.setup();
    mockPost
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        data: { success: true, data: { token: 'retry-token', user: {} } },
      });
    render(<LoginPage />);

    await fillAndSubmit(user, 'ada@example.com', 'Secret123!');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled()
    );
    expect(mockPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(localStorage.getItem('authToken')).toBe('retry-token');
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  it('toggles password visibility without submitting the form', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const password = screen.getByLabelText(/^password/i);
    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(password).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(password).toHaveAttribute('type', 'password');
    expect(mockPost).not.toHaveBeenCalled();
  });
});
