#!/usr/bin/env node
// Copies frontend/dist/* into backend/public/
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'frontend', 'dist');
const dest = path.join(__dirname, 'backend', 'public');

if (!fs.existsSync(src)) {
  console.error('frontend/dist not found. Run "npm run build:frontend" first.');
  process.exit(1);
}

// Remove old public dir
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

// Copy recursively
fs.cpSync(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
