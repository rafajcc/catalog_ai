// Tests for the central version management: the ROOT package.json is the single
// source of truth and scripts/sync-version.js propagates it to the derived
// files (backend/frontend package.json, the app entries of the lock files and
// the version tokens in the docs). The historical CHANGELOG entries are never
// touched.

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
    for (const sub of ['backend', 'frontend', 'docs']) {
      fs.mkdirSync(path.join(dir, sub));
    }
    fs.writeFileSync(path.join(dir, 'package.json'), makePkg('2.0.0'));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), makeLock('1.2.8'));
    fs.writeFileSync(path.join(dir, 'backend', 'package.json'), makePkg('1.2.8'));
    fs.writeFileSync(path.join(dir, 'backend', 'package-lock.json'), makeLock('1.2.8'));
    fs.writeFileSync(path.join(dir, 'frontend', 'package.json'), makePkg('1.2.8'));
    fs.writeFileSync(path.join(dir, 'frontend', 'package-lock.json'), makeLock('1.2.8'));
    fs.writeFileSync(path.join(dir, 'docs', 'API.md'), 'Badge: v1.2.8\n"version": "1.2.8"\n');
    fs.writeFileSync(path.join(dir, 'docs', 'DEPLOYMENT.md'), '{"success":true,"version":"1.2.8"}\n');
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
    expect(summary['docs/API.md']).toBe(2);
    expect(summary['docs/DEPLOYMENT.md']).toBe(1);

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'backend', 'package.json'), 'utf8')).version).toBe('2.0.0');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'frontend', 'package.json'), 'utf8')).version).toBe('2.0.0');
    for (const lock of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, lock), 'utf8'));
      expect(json.version).toBe('2.0.0');
      expect(json.packages[''].version).toBe('2.0.0');
    }
    expect(fs.readFileSync(path.join(dir, 'docs', 'API.md'), 'utf8')).toBe('Badge: v2.0.0\n"version": "2.0.0"\n');
    expect(fs.readFileSync(path.join(dir, 'docs', 'DEPLOYMENT.md'), 'utf8')).toBe('{"success":true,"version":"2.0.0"}\n');
  });

  it('is a no-op when the derived version already matches the root version', () => {
    expect(syncAll(dir, '1.2.8')).toEqual({});
  });
});