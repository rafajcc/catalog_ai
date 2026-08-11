import '@testing-library/jest-dom';

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = jest.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = jest.fn() as unknown as typeof URL.revokeObjectURL;
}

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : '';
  if (message.includes('not wrapped in act')) {
    return;
  }
  originalConsoleError(...args);
};
