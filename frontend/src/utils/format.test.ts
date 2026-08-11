import { formatBytes, formatDate, formatNumber, formatPercent, truncate } from './format';

describe('formatBytes', () => {
  it('formats bytes with the correct unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('handles missing and invalid values', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats percentages with one decimal', () => {
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(87.5)).toBe('87.5%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('handles missing and invalid values', () => {
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('formats numbers using locale grouping', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('handles missing and invalid values', () => {
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('formats Date objects and ISO strings', () => {
    const date = new Date('2024-03-15T10:30:00Z');
    expect(formatDate(date)).toMatch(/2024/);
    expect(formatDate(date.toISOString())).toMatch(/2024/);
  });

  it('handles missing and invalid values', () => {
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('truncate', () => {
  it('keeps short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with an ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('handles nullish values', () => {
    expect(truncate(undefined, 5)).toBe('');
    expect(truncate(null, 5)).toBe('');
  });
});
