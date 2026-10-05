import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// The default 1s timeout for waitFor is too tight when the whole file runs in
// parallel on a busy machine: renders that take a couple of seconds made tests
// fail at random (the app was fine, the machine was not). 5s keeps them stable
// without hiding a real regression, which still has to be much slower than that.
configure({ asyncUtilTimeout: 5000 });
