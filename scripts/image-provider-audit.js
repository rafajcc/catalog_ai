'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const MESSAGE_REQUEST = 'Image provider request';
const MESSAGE_RESPONSE = 'Image provider response';
const MESSAGE_ERROR = 'Image provider request error';
const MESSAGE_QUOTA = 'Image provider skipped by quota';
const MESSAGE_BUDGET = 'Image search budget spent, stopping with the images already found';
const MESSAGE_TIMEOUT_RE = /^El proveedor de imágenes (\S+) agotó el presupuesto de la búsqueda/;
const LEVEL_RE = /\b(INFO|WARN|ERROR|DEBUG): /;

const HELP = `Uso: node scripts/image-provider-audit.js <log...> [opciones]

Audita la efectividad de los proveedores de imágenes a partir del log de la app.
Acepta uno o varios ficheros (también .gz). Sin ficheros lee la entrada estándar.

Opciones:
  --json              Salida JSON
  --csv               Salida CSV
  --sort <campo>      calls | success | errors | urls | latency | name (def. calls)
  --min-calls <n>     Oculta proveedores con menos de n llamadas
  --provider <slug>   Solo estos slugs, separados por comas
  --since <fecha>     Ignora eventos anteriores (ISO o YYYY-MM-DD)
  --until <fecha>     Ignora eventos posteriores (ISO o YYYY-MM-DD)
  -h, --help          Muestra esta ayuda

Ejemplos:
  node scripts/image-provider-audit.js logs/app.log
  node scripts/image-provider-audit.js logs/app.log.1.gz logs/app.log --sort success
  npm run audit:images -- logs/app.log
  Get-Content logs/app.log | node scripts/image-provider-audit.js`;

function parseArgs(argv) {
  const options = {
    files: [],
    json: false,
    csv: false,
    sort: 'calls',
    minCalls: 0,
    providers: null,
    since: null,
    until: null,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--csv') options.csv = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--sort') options.sort = String(argv[++i] ?? '');
    else if (arg === '--min-calls') options.minCalls = parseInt(argv[++i] ?? '', 10) || 0;
    else if (arg === '--provider') {
      options.providers = String(argv[++i] ?? '')
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean);
    } else if (arg === '--since') options.since = parseDate(argv[++i]);
    else if (arg === '--until') options.until = parseDate(argv[++i], true);
    else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Opción desconocida: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.json && options.csv) throw new Error('Usa --json o --csv, no ambos.');
  if (!['calls', 'success', 'errors', 'urls', 'latency', 'name'].includes(options.sort)) {
    throw new Error(`--sort inválido: ${options.sort}`);
  }
  return options;
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Fecha inválida: ${value}`);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) return ms + 86399999;
  return ms;
}

function emptyStats(slug) {
  return {
    slug,
    calls: 0,
    ok: 0,
    empty: 0,
    errors: 0,
    timeouts: 0,
    quota: 0,
    budgetStops: 0,
    images: 0,
    durations: [],
    references: new Set(),
    firstSeen: null,
    lastSeen: null
  };
}

function parseLine(line) {
  if (
    !line.includes('Image provider') &&
    !line.includes('Image search budget') &&
    !line.includes('El proveedor de imágenes')
  ) {
    return null;
  }
  const level = LEVEL_RE.exec(line);
  if (!level) return null;
  const rest = line.slice(level.index + level[0].length);
  const brace = rest.indexOf('{');
  const text = (brace >= 0 ? rest.slice(0, brace) : rest).trim();
  let meta = {};
  if (brace >= 0) {
    try {
      meta = JSON.parse(rest.slice(brace));
    } catch {
      meta = {};
    }
  }
  const timestamp = parseTimestamp(line);
  return { text, meta, timestamp };
}

function parseTimestamp(line) {
  if (!line.startsWith('[')) return null;
  const end = line.indexOf(']');
  if (end < 0) return null;
  const raw = line.slice(1, end);
  return Number.isNaN(Date.parse(raw)) ? null : raw;
}

function addEvent(container, event, options) {
  const { text, meta, timestamp } = event;
  const timeout = MESSAGE_TIMEOUT_RE.exec(text);
  const known =
    text === MESSAGE_REQUEST ||
    text === MESSAGE_RESPONSE ||
    text === MESSAGE_ERROR ||
    text === MESSAGE_QUOTA ||
    text === MESSAGE_BUDGET ||
    Boolean(timeout);
  if (!known) return;
  const slug = timeout ? timeout[1] : trackedSlug(meta, options);
  if (!slug || !inWindow(timestamp, options)) return;
  if (options.providers && !options.providers.includes(slug)) return;
  const stats = getStats(container, slug);
  if (text === MESSAGE_REQUEST) {
    stats.calls += 1;
  } else if (text === MESSAGE_RESPONSE) {
    if (meta.status === 'ok') stats.ok += 1;
    else stats.empty += 1;
    if (Number.isFinite(meta.urls)) stats.images += meta.urls;
    if (Number.isFinite(meta.durationMs)) stats.durations.push(meta.durationMs);
  } else if (text === MESSAGE_ERROR) {
    stats.errors += 1;
    if (Number.isFinite(meta.durationMs)) stats.durations.push(meta.durationMs);
  } else if (text === MESSAGE_QUOTA) {
    stats.quota += 1;
  } else if (text === MESSAGE_BUDGET) {
    stats.budgetStops += 1;
  } else if (timeout) {
    stats.timeouts += 1;
  }
  if (typeof meta.reference === 'string' && meta.reference) stats.references.add(meta.reference);
  touch(stats, timestamp);
  container.matched += 1;
}

function trackedSlug(meta, options) {
  const slug = meta.slug;
  if (typeof slug !== 'string' || !slug) return null;
  if (options.providers && !options.providers.includes(slug)) return null;
  return slug;
}

function getStats(container, slug) {
  let stats = container.providers.get(slug);
  if (!stats) {
    stats = emptyStats(slug);
    container.providers.set(slug, stats);
  }
  return stats;
}

function touch(stats, timestamp) {
  if (!timestamp) return;
  if (!stats.firstSeen || timestamp < stats.firstSeen) stats.firstSeen = timestamp;
  if (!stats.lastSeen || timestamp > stats.lastSeen) stats.lastSeen = timestamp;
}

function inWindow(timestamp, options) {
  if (!timestamp || (options.since === null && options.until === null)) return true;
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return true;
  if (options.since !== null && ms < options.since) return false;
  if (options.until !== null && ms > options.until) return false;
  return true;
}

function finalize(stats) {
  const attempts = Math.max(stats.calls, stats.ok + stats.empty + stats.errors + stats.timeouts);
  const durationSum = stats.durations.reduce((sum, value) => sum + value, 0);
  const sortedDurations = [...stats.durations].sort((a, b) => a - b);
  return {
    slug: stats.slug,
    calls: stats.calls,
    ok: stats.ok,
    empty: stats.empty,
    errors: stats.errors,
    timeouts: stats.timeouts,
    quota: stats.quota,
    budgetStops: stats.budgetStops,
    attempts,
    lateResponses: Math.max(0, stats.ok + stats.empty + stats.errors + stats.timeouts - stats.calls),
    successRate: attempts > 0 ? stats.ok / attempts : null,
    images: stats.images,
    avgImagesPerOk: stats.ok > 0 ? stats.images / stats.ok : null,
    avgDurationMs: stats.durations.length > 0 ? durationSum / stats.durations.length : null,
    p95DurationMs: percentile(sortedDurations, 0.95),
    references: stats.references.size,
    firstSeen: stats.firstSeen,
    lastSeen: stats.lastSeen
  };
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(ratio * sortedValues.length) - 1));
  return sortedValues[index];
}

function sortRows(rows, sort) {
  const byName = (a, b) => a.slug.localeCompare(b.slug);
  const comparators = {
    calls: (a, b) => b.calls - a.calls || byName(a, b),
    success: (a, b) => (b.successRate ?? -1) - (a.successRate ?? -1) || b.attempts - a.attempts || byName(a, b),
    errors: (a, b) => b.errors + b.timeouts - (a.errors + a.timeouts) || b.calls - a.calls || byName(a, b),
    urls: (a, b) => b.images - a.images || b.calls - a.calls || byName(a, b),
    latency: (a, b) => (b.avgDurationMs ?? -1) - (a.avgDurationMs ?? -1) || b.calls - a.calls || byName(a, b),
    name: byName
  };
  return rows.sort(comparators[sort]);
}

function formatInt(value) {
  return Number.isFinite(value) ? String(value) : '-';
}

function formatMs(value) {
  return value === null ? '-' : value.toFixed(1);
}

function formatPct(value) {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function renderTable(rows, container) {
  const headers = ['Provider', 'Calls', 'OK', 'Empty', 'Err', 'TOut', 'Succ', 'Images', 'Avg ms', 'P95 ms', 'Quota', 'Budget'];
  const data = rows.map((s) => [
    s.slug,
    formatInt(s.calls),
    formatInt(s.ok),
    formatInt(s.empty),
    formatInt(s.errors),
    formatInt(s.timeouts),
    formatPct(s.successRate),
    formatInt(s.images),
    formatMs(s.avgDurationMs),
    formatMs(s.p95DurationMs),
    formatInt(s.quota),
    formatInt(s.budgetStops)
  ]);
  const widths = headers.map((header, index) =>
    Math.max(String(header).length, ...data.map((row) => String(row[index]).length))
  );
  const line = (cells) =>
    cells
      .map((cell, index) => (index === 0 ? String(cell).padEnd(widths[index]) : String(cell).padStart(widths[index])))
      .join('  ')
      .trimEnd();

  const out = [line(headers), line(widths.map((width) => '-'.repeat(width)))];
  for (const row of data) out.push(line(row));

  const totalCalls = rows.reduce((sum, s) => sum + s.calls, 0);
  const totalOk = rows.reduce((sum, s) => sum + s.ok, 0);
  const totalAttempts = rows.reduce((sum, s) => sum + s.attempts, 0);
  const totalImages = rows.reduce((sum, s) => sum + s.images, 0);
  const totalQuota = rows.reduce((sum, s) => sum + s.quota, 0);
  const totalBudget = rows.reduce((sum, s) => sum + s.budgetStops, 0);
  const totalTimeouts = rows.reduce((sum, s) => sum + s.timeouts, 0);
  const totalLate = rows.reduce((sum, s) => sum + s.lateResponses, 0);

  out.push('');
  out.push(
    `Totales: ${totalCalls} llamadas, ${totalOk} OK (${formatPct(totalAttempts > 0 ? totalOk / totalAttempts : null)}), ` +
      `${totalImages} imágenes validadas, ${totalQuota} saltos por cuota, ${totalBudget} cortes por presupuesto, ${totalTimeouts} timeouts.`
  );
  out.push(
    `Líneas leídas: ${container.lines}, eventos de proveedor: ${container.matched}.`
  );
  out.push(
    'Nota: "Images" son las URLs validadas por cada proveedor antes de deduplicar entre proveedores; ' +
      'no equivale a imágenes aportadas al resultado final. "Succ" = OK / intentos.'
  );
  out.push(
    'Nota: "feeds" se intenta siempre primero y el resto va en round robin; las llamadas no están equilibradas por diseño.'
  );
  if (totalLate > 0) {
    out.push(
      `Aviso: ${totalLate} respuesta(s) sin petición previa en el log. Suele ser una respuesta tardía tras un timeout o logs incompletos/rotados.`
    );
  }
  return out.join('\n');
}

function renderCsv(rows) {
  const header = [
    'provider',
    'calls',
    'ok',
    'empty',
    'errors',
    'timeouts',
    'quota_skips',
    'budget_stops',
    'attempts',
    'late_responses',
    'success_rate',
    'images',
    'avg_images_per_ok',
    'avg_duration_ms',
    'p95_duration_ms',
    'distinct_references',
    'first_seen',
    'last_seen'
  ];
  const csvCell = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header.join(',')];
  for (const s of rows) {
    lines.push(
      [
        s.slug,
        s.calls,
        s.ok,
        s.empty,
        s.errors,
        s.timeouts,
        s.quota,
        s.budgetStops,
        s.attempts,
        s.lateResponses,
        s.successRate === null ? '' : s.successRate.toFixed(4),
        s.images,
        s.avgImagesPerOk === null ? '' : s.avgImagesPerOk.toFixed(2),
        s.avgDurationMs === null ? '' : s.avgDurationMs.toFixed(1),
        s.p95DurationMs === null ? '' : s.p95DurationMs.toFixed(1),
        s.references,
        s.firstSeen ?? '',
        s.lastSeen ?? ''
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

function renderJson(rows, container, options) {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sources: options.files.length > 0 ? options.files : ['<stdin>'],
      lines: container.lines,
      matchedEvents: container.matched,
      providers: rows
    },
    null,
    2
  );
}

function openInput(file) {
  const stream = fs.createReadStream(file);
  return file.endsWith('.gz') ? stream.pipe(zlib.createGunzip()) : stream;
}

async function readLines(input, options, container) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    container.lines += 1;
    if (!line) continue;
    const event = parseLine(line);
    if (event) addEvent(container, event, options);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const container = { lines: 0, matched: 0, providers: new Map() };
  if (options.files.length === 0) {
    if (process.stdin.isTTY) {
      console.log(HELP);
      process.exitCode = 1;
      return;
    }
    await readLines(process.stdin, options, container);
  } else {
    for (const file of options.files) {
      if (!fs.existsSync(file)) throw new Error(`No existe el fichero: ${file}`);
      await readLines(openInput(file), options, container);
    }
  }

  let rows = [...container.providers.values()].map(finalize);
  if (options.minCalls > 0) rows = rows.filter((s) => s.calls >= options.minCalls);
  rows = sortRows(rows, options.sort);

  if (rows.length === 0) {
    console.error('No se encontraron eventos de proveedores de imágenes en el log.');
    process.exitCode = 2;
    return;
  }

  if (options.json) console.log(renderJson(rows, container, options));
  else if (options.csv) console.log(renderCsv(rows));
  else {
    console.log('Auditoría de proveedores de imágenes');
    console.log(`Fuentes: ${options.files.length > 0 ? options.files.join(', ') : '<stdin>'}`);
    if (options.since !== null || options.until !== null) {
      console.log(
        `Ventana: ${options.since !== null ? new Date(options.since).toISOString() : '-'} .. ` +
          `${options.until !== null ? new Date(options.until).toISOString() : '-'}`
      );
    }
    console.log('');
    console.log(renderTable(rows, container));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[image-provider-audit] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, parseLine, addEvent, finalize, sortRows, renderCsv };
