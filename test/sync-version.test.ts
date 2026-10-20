// Tests for the central version management: the ROOT package.json is the single
// source of truth and scripts/sync-version.js propagates it to the derived
// files (backend/frontend package.json and the app entries of the lock files).
// The docs use a `<version>` placeholder and the historical CHANGELOG entries
// are never touched.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { syncAll } from '../scripts/sync-version';

function makePkg(version: string): string {
  return JSON.stringify({ name: 'x', version }, null, 2) + '\n';
}

function makeLock(version: string): string {
  return JSON.stringify(
    { name: 'x', version, lockfileVersion: 3, packages: { '': { name: 'x', version } } },
    null,
    2
  ) + '\n';
}

describe('sync-version', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogai-syncver-'));
    for (const sub of ['backend', 'frontend']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    fs.writeFileSync(path.join(dir, 'package.json'), makePkg('2.0.0'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), makeLock('1.2.8'));
    fs.writeFileSync(path.join(dir, 'backend', 'package.json'), makePkg('1.2.8'));
    fs.writeFileSync(path.join(dir, 'backend', 'package-lock.json'), makeLock('1.2.8'));
    fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), makePkg('1.2.8'));
    fs.writeFileSync(path.join(dir, 'frontend', 'package-lock.json'), makeLock('1.2.8'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('propagates the root version to every derived file', () => {
    const summary = syncAll(dir, '2.0.0');

    expect(summary['backend/package.json']).toBe(1);
    expect(summary['frontend/package.json']).toBe(1);
    expect(summary['package-lock.json']).toBe(2);
    expect(summary['backend/package-lock.json']).toBe(2);
    expect(summary['frontend/package-lock.json']).toBe(2);

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'backend', 'package.json'), 'utf8')).version).toBe('2.0.0');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'frontend', 'package.json'), 'utf8')).version).toBe('2.0.0');
    for (const lock of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, lock), 'utf8'));
      expect(json.version).toBe('2.0.0');
      expect(json.packages[''].version).toBe('2.0.0');
    }
  });

  it('is a no-op when the derived version already matches the root version', () => {
    expect(syncAll(dir, '1.2.8')).toEqual({});
  });
});