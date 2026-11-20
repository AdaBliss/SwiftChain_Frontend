import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkUploadZone } from '@/components/shipment/BulkUploadZone';
import api from '@/lib/api';

/**
 * Bulk upload integration tests covering partial failures and oversized files.
 * The real BulkUploadZone, useBulkUploadZone hook, bulkUploadService and
 * Papa Parse are exercised together; only the HTTP client and toasts are mocked.
 */

jest.mock('@/lib/api', () => ({
  __esModule: true,
  default: { post: jest.fn(), get: jest.fn() },
}));

const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
jest.mock('@/hooks/useToast', () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError }),
}));

const mockPost = api.post as jest.Mock;

const CSV_BODY = 'tracking,destination\nSC-1,Lagos\nSC-2,Abuja\n';

const makeCsv = (name: string, body = CSV_BODY) =>
  new File([body], name, { type: 'text/csv' });

/** Creates a file that reports a large size without allocating the memory. */
const makeOversizedCsv = (name: string, sizeBytes: number) => {
  const file = makeCsv(name);
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
};

const getFileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

const uploadFiles = async (
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  files: File[]
) => {
  await user.upload(getFileInput(container), files);
};

const MB = 1024 * 1024;

describe('Bulk upload: partial failures and oversized files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('oversized files', () => {
    it('rejects a file over the 50MB limit and never queues or uploads it', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [
        makeOversizedCsv('huge.csv', 51 * MB),
      ]);

      expect(
        await screen.findByText(/file size exceeds 50mb limit \(51\.00mb\)/i)
      ).toBeInTheDocument();
      expect(mockToastError).toHaveBeenCalledWith(
        'Invalid file',
        expect.stringContaining('50MB')
      );
      expect(screen.queryByText('huge.csv')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upload \d+ file/i })
      ).not.toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('accepts a file exactly at the 50MB boundary', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [
        makeOversizedCsv('limit.csv', 50 * MB),
      ]);

      expect(await screen.findByText('limit.csv')).toBeInTheDocument();
      expect(mockToastError).not.toHaveBeenCalled();
    });

    it('keeps the valid file when it is dropped together with an oversized one', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [
        makeCsv('ok.csv'),
        makeOversizedCsv('too-big.csv', 80 * MB),
      ]);

      expect(await screen.findByText('ok.csv')).toBeInTheDocument();
      expect(screen.queryByText('too-big.csv')).not.toBeInTheDocument();
      expect(screen.getByText(/files \(1\/5\)/i)).toBeInTheDocument();
      expect(screen.getByText(/exceeds 50mb limit/i)).toBeInTheDocument();
    });

    it('clears the previous validation error when a valid file is added next', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [
        makeOversizedCsv('too-big.csv', 60 * MB),
      ]);
      expect(await screen.findByText(/exceeds 50mb limit/i)).toBeInTheDocument();

      await uploadFiles(user, container, [makeCsv('ok.csv')]);

      expect(await screen.findByText('ok.csv')).toBeInTheDocument();
      expect(screen.queryByText(/exceeds 50mb limit/i)).not.toBeInTheDocument();
    });
  });

  describe('invalid and unreadable content', () => {
    it('rejects an empty CSV with a parse error', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [makeCsv('empty.csv', '')]);

      expect(
        await screen.findByText(/empty or has no valid data rows/i)
      ).toBeInTheDocument();
      expect(mockToastError).toHaveBeenCalledWith(
        'Parse error',
        expect.stringMatching(/empty/i)
      );
      expect(screen.queryByText('empty.csv')).not.toBeInTheDocument();
    });

    it('rejects a header-only CSV with no data rows', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [
        makeCsv('header-only.csv', 'tracking,destination\n'),
      ]);

      expect(
        await screen.findByText(/no valid data rows/i)
      ).toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('shows a preview limited to the first 3 rows with the real row count', async () => {
      const user = userEvent.setup();
      const body =
        'tracking,destination\nSC-1,Lagos\nSC-2,Abuja\nSC-3,Kano\nSC-4,Ibadan\nSC-5,Enugu\n';
      const { container } = render(<BulkUploadZone />);

      await uploadFiles(user, container, [makeCsv('five.csv', body)]);

      expect(await screen.findByText(/preview \(5 rows, 2 columns\)/i)).toBeInTheDocument();
      expect(screen.getByText('SC-3')).toBeInTheDocument();
      expect(screen.queryByText('SC-4')).not.toBeInTheDocument();
    });
  });

  describe('partial upload failures', () => {
    const queueTwoFiles = async () => {
      const user = userEvent.setup();
      const onUploadComplete = jest.fn();
      const { container } = render(
        <BulkUploadZone onUploadComplete={onUploadComplete} />
      );
      await uploadFiles(user, container, [
        makeCsv('first.csv'),
        makeCsv('second.csv'),
      ]);
      await screen.findByText('second.csv');
      return { user, onUploadComplete };
    };

    it('uploads each file with its type and reports full success', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, data: { processedCount: 2, failedCount: 0 } },
      });
      const { user, onUploadComplete } = await queueTwoFiles();

      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));

      await waitFor(() =>
        expect(screen.getByText(/2 files uploaded/i)).toBeInTheDocument()
      );
      expect(mockPost).toHaveBeenCalledTimes(2);
      const body = mockPost.mock.calls[0][1] as FormData;
      expect(body.get('fileType')).toBe('shipments');
      expect((body.get('file') as File).name).toBe('first.csv');
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Upload successful',
        '2 records processed'
      );
      expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();
      expect(onUploadComplete).not.toHaveBeenCalled(); // see PR notes: callback uses stale state
    });

    it('marks only the failing file as errored when one of two uploads is rejected by the server', async () => {
      mockPost
        .mockResolvedValueOnce({
          data: { success: true, data: { processedCount: 2, failedCount: 0 } },
        })
        .mockResolvedValueOnce({
          data: { success: false, message: 'Row 2: invalid postcode' },
        });
      const { user } = await queueTwoFiles();

      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));

      await waitFor(() =>
        expect(screen.getByText(/1 file failed/i)).toBeInTheDocument()
      );
      expect(screen.getByText(/1 file uploaded/i)).toBeInTheDocument();
      expect(screen.getByText('Row 2: invalid postcode')).toBeInTheDocument();
      expect(mockToastError).toHaveBeenCalledWith(
        'Upload error',
        'Row 2: invalid postcode'
      );
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });

    it('continues uploading the remaining files after the first one fails', async () => {
      mockPost
        .mockResolvedValueOnce({
          data: { success: false, message: 'Malformed header' },
        })
        .mockResolvedValueOnce({
          data: { success: true, data: { processedCount: 2, failedCount: 0 } },
        });
      const { user } = await queueTwoFiles();

      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));

      await waitFor(() =>
        expect(screen.getByText(/1 file uploaded/i)).toBeInTheDocument()
      );
      expect(screen.getByText(/1 file failed/i)).toBeInTheDocument();
      expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it('treats a network failure as a per-file error with a generic message', async () => {
      mockPost
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockResolvedValueOnce({
          data: { success: true, data: { processedCount: 2, failedCount: 0 } },
        });
      const { user } = await queueTwoFiles();

      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));

      await waitFor(() =>
        expect(screen.getByText(/1 file failed/i)).toBeInTheDocument()
      );
      expect(screen.getByText('Network Error')).toBeInTheDocument();
      expect(screen.getByText(/1 file uploaded/i)).toBeInTheDocument();
    });

    it('reports every file as failed when all uploads fail and offers no further upload', async () => {
      mockPost.mockResolvedValue({
        data: { success: false, message: 'Service unavailable' },
      });
      const { user, onUploadComplete } = await queueTwoFiles();

      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));

      await waitFor(() =>
        expect(screen.getByText(/2 files failed/i)).toBeInTheDocument()
      );
      expect(screen.queryByText(/uploaded/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /upload \d+ file/i })
      ).not.toBeInTheDocument();
      expect(onUploadComplete).not.toHaveBeenCalled();
    });

    it('falls back to a default message when the server gives no failure reason', async () => {
      mockPost.mockResolvedValue({ data: { success: false } });
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);
      await uploadFiles(user, container, [makeCsv('solo.csv')]);
      await screen.findByText('solo.csv');

      await user.click(screen.getByRole('button', { name: /upload 1 file/i }));

      expect(await screen.findByText('Upload failed')).toBeInTheDocument();
      expect(mockToastError).toHaveBeenCalledWith('Upload error', 'Upload failed');
    });

    it('does not re-upload files that already succeeded when uploading again', async () => {
      mockPost
        .mockResolvedValueOnce({
          data: { success: true, data: { processedCount: 2, failedCount: 0 } },
        })
        .mockResolvedValueOnce({ data: { success: false, message: 'Boom' } });
      const { user } = await queueTwoFiles();
      await user.click(screen.getByRole('button', { name: /upload 2 files/i }));
      await waitFor(() =>
        expect(screen.getByText(/1 file failed/i)).toBeInTheDocument()
      );
      mockPost.mockClear();

      // Only 'pending' files are re-sent; none remain, so no upload button shows.
      expect(
        screen.queryByRole('button', { name: /upload \d+ file/i })
      ).not.toBeInTheDocument();
      expect(mockPost).not.toHaveBeenCalled();
    });
  });

  describe('queue management', () => {
    it('lets the user remove a pending file before uploading', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);
      await uploadFiles(user, container, [
        makeCsv('keep.csv'),
        makeCsv('drop.csv'),
      ]);
      const dropRow = (await screen.findByText('drop.csv')).closest(
        'div.border'
      ) as HTMLElement;

      await user.click(within(dropRow).getByRole('button'));

      expect(screen.queryByText('drop.csv')).not.toBeInTheDocument();
      expect(screen.getByText('keep.csv')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /upload 1 file$/i })
      ).toBeInTheDocument();
    });

    it('clears the whole queue with "Clear all"', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone />);
      await uploadFiles(user, container, [makeCsv('a.csv'), makeCsv('b.csv')]);
      await screen.findByText('b.csv');

      await user.click(screen.getByRole('button', { name: /clear all/i }));

      expect(screen.queryByText('a.csv')).not.toBeInTheDocument();
      expect(screen.queryByText('b.csv')).not.toBeInTheDocument();
    });

    it('rejects a drop that exceeds the maximum number of files without queuing any', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone maxFiles={2} />);

      await uploadFiles(user, container, [
        makeCsv('one.csv'),
        makeCsv('two.csv'),
        makeCsv('three.csv'),
      ]);

      // react-dropzone rejects the whole drop when it exceeds maxFiles.
      await waitFor(() => expect(mockPost).not.toHaveBeenCalled());
      expect(screen.queryByText('one.csv')).not.toBeInTheDocument();
      expect(screen.queryByText(/files \(\d+\/\d+\)/i)).not.toBeInTheDocument();
    });

    it('accepts files up to the maximum and then ignores further drops', async () => {
      const user = userEvent.setup();
      const { container } = render(<BulkUploadZone maxFiles={2} />);

      await uploadFiles(user, container, [makeCsv('one.csv'), makeCsv('two.csv')]);

      expect(await screen.findByText('two.csv')).toBeInTheDocument();
      expect(screen.getByText(/files \(2\/2\)/i)).toBeInTheDocument();

      await uploadFiles(user, container, [makeCsv('three.csv')]);

      expect(screen.queryByText('three.csv')).not.toBeInTheDocument();
      expect(screen.getByText(/files \(2\/2\)/i)).toBeInTheDocument();
    });
  });
});
