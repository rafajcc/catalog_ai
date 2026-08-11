// Download helpers

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface ApiErrorPayload {
  message?: unknown;
  code?: string;
  details?: Record<string, unknown> | undefined;
}

export function getApiError(error: unknown): ApiErrorPayload | undefined {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: unknown; error?: ApiErrorPayload } } }).response;
    return response?.data?.error ?? (response?.data?.message !== undefined ? { message: response.data.message } : undefined);
  }
  return undefined;
}

export function getErrorMessage(error: unknown): string {
  const apiError = getApiError(error);
  const serverMessage = apiError?.message;
  if (typeof serverMessage === 'string' && serverMessage.length > 0) {
    return serverMessage;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'An unexpected error occurred';
}
