import { downloadBlob, getErrorMessage } from './download';

describe('downloadBlob', () => {
  let createSpy: MockInstance;
  let revokeSpy: MockInstance;
  let clickSpy: MockInstance;

  beforeEach(() => {
    clickSpy = vi.fn();
    createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockReturnValue({ click: clickSpy } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => undefined as never);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers a download with the given filename', () => {
    const blob = new Blob(['data']);
    downloadBlob(blob, 'report.csv');

    expect(createSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake');
  });
});

describe('getErrorMessage', () => {
  it('returns the error message for Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns the server message for axios-style errors', () => {
    const axiosError = {
      response: { data: { success: false, error: { message: 'Only .csv files are allowed' } } }
    };
    expect(getErrorMessage(axiosError)).toBe('Only .csv files are allowed');
  });

  it('returns a top-level server message when present', () => {
    const axiosError = { response: { data: { success: false, message: 'Top level message' } } };
    expect(getErrorMessage(axiosError)).toBe('Top level message');
  });

  it('falls back to the axios message when there is no server message', () => {
    const axiosError = new Error('Request failed with status code 500');
    expect(getErrorMessage(axiosError)).toBe('Request failed with status code 500');
  });

  it('returns non-empty string errors', () => {
    expect(getErrorMessage('custom failure')).toBe('custom failure');
  });

  it('falls back to a generic message', () => {
    expect(getErrorMessage(undefined)).toBe('An unexpected error occurred');
    expect(getErrorMessage({})).toBe('An unexpected error occurred');
    expect(getErrorMessage('')).toBe('An unexpected error occurred');
  });
});
