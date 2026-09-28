// Central version management.
//
// The ROOT package.json is the single source of truth for the app version.
// Everything else that repeats the version — backend/frontend package.json,
// the top-level entries of the three package-lock files and the version
// examples in docs/API/DEPLOYMENT — is derived from it:
//
//   npm run sync:version    # read root version and propagate it everywhere
//   npm run build           # prebuild runs sync:version automatically
//
// The historical versions written in CHANGELOG.md are intentionally left alone.
// The runtime reads the version from the root package.json (backend/src/app.ts),
// so even a deploy that never ran this script reports the root version.

const fs = require('fs');
const path = require('path');

// npm lockfile v3 repeats the app version twice near the top: the root
// "version" field and the packages[""].version entry. Only those two are
// rewritten; dependency versions that happen to match are left untouched.
const LOCK_APP_VERSION_ENTRIES = 2;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readVersion(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

// Replaces the first `max` occurrences of `"version": "<current>"` on their own
// line, preserving the rest of the file byte for byte (including line endings).
function replaceVersionLines(file, current, next, max) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(eol);
  const regex = new RegExp(`^\\s*"version":\\s*"${escapeRegExp(current)}",?\\s*$`);
  let found = 0;
  const out = lines.map((line) => {
    if (found >= max) return line;
    if (!regex.test(line)) return line;
    found += 1;
    return line.replace(current, next);
  });
  fs.writeFileSync(file, out.join(eol));
  return found;
}

// Replaces every occurrence of the bare version token (covers `v1.2.8`,
// `"version": "1.2.8"` and `"version":"1.2.8"`).
function replaceVersionEverywhere(file, current, next) {
  const raw = fs.readFileSync(file, 'utf8');
  const parts = raw.split(current);
  if (parts.length > 1) {
    fs.writeFileSync(file, parts.join(next));
  }
  return parts.length - 1;
}

// Propagates `next` to every derived file below `rootDir`. `current` is read
// from backend/package.json (the previously propagated value). Returns a map
// of file (repo-relative) -> number of replaced occurrences.
function syncAll(rootDir, next) {
  const backendPkg = path.join(rootDir, 'backend', 'package.json');
  const current = readVersion(backendPkg);
  if (current === next) {
    return {};
  }
  const summary = {};

  function track(relative, count) {
    if (count > 0) summary[relative] = (summary[relative] ?? 0) + count;
  }

  // App package.json files: one version line each.
  for (const [relative] of [
    ['backend/package.json'],
    ['frontend/package.json']
  ]) {
    track(relative, replaceVersionLines(path.join(rootDir, relative), current, next, 1));
  }

  // Lockfiles: only the two app-level version entries.
  for (const relative of [
    'package-lock.json',
    'backend/package-lock.json',
    'frontend/package-lock.json'
  ]) {
    const file = path.join(rootDir, relative);
    if (!fs.existsSync(file)) continue;
    track(relative, replaceVersionLines(file, current, next, LOCK_APP_VERSION_ENTRIES));
  }

  // Docs: the version tokens in the example responses / prose.
  for (const relative of [
    'docs/API.md',
    'docs/API_es.md',
    'docs/DEPLOYMENT.md',
    'docs/DEPLOYMENT_es.md'
  ]) {
    const file = path.join(rootDir, relative);
    if (!fs.existsSync(file)) continue;
    track(relative, replaceVersionEverywhere(file, current, next));
  }

  return summary;
}

module.exports = { syncAll, readVersion };

if (require.main === module) {
  const rootDir = path.join(__dirname, '..');
  const next = readVersion(path.join(rootDir, 'package.json'));
  const current = readVersion(path.join(rootDir, 'backend', 'package.json'));
  if (current === next) {
    console.log(`[sync-version] version ${next} is already propagated everywhere.`);
    process.exit(0);
  }
  const summary = syncAll(rootDir, next);
  const total = Object.values(summary).reduce((sum, n) => sum + n, 0);
  console.log(`[sync-version] version ${current} -> ${next}: ${total} replacement(s) across ${Object.keys(summary).length} file(s).`);
  for (const [file, count] of Object.entries(summary)) {
    console.log(`  ${file}: ${count}`);
  }
  process.exit(total > 0 ? 0 : 1);
}