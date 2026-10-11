import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from '@/lib/http-range';

describe('parseRangeHeader', () => {
  it('returns the full body without a header', () => {
    expect(parseRangeHeader(null, 100)).toEqual({ type: 'full' });
    expect(parseRangeHeader('', 100)).toEqual({ type: 'full' });
  });
  it('parses explicit and open-ended ranges', () => {
    expect(parseRangeHeader('bytes=0-9', 100)).toEqual({ type: 'partial', start: 0, end: 9 });
    expect(parseRangeHeader('bytes=90-', 100)).toEqual({ type: 'partial', start: 90, end: 99 });
    expect(parseRangeHeader('bytes=50-500', 100)).toEqual({ type: 'partial', start: 50, end: 99 });
  });
  it('parses suffix ranges', () => {
    expect(parseRangeHeader('bytes=-10', 100)).toEqual({ type: 'partial', start: 90, end: 99 });
    expect(parseRangeHeader('bytes=-500', 100)).toEqual({ type: 'partial', start: 0, end: 99 });
    expect(parseRangeHeader('bytes=-0', 100)).toEqual({ type: 'unsatisfiable' });
  });
  it('flags unsatisfiable ranges', () => {
    expect(parseRangeHeader('bytes=100-', 100)).toEqual({ type: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=20-10', 100)).toEqual({ type: 'unsatisfiable' });
    expect(parseRangeHeader('bytes=-5', 0)).toEqual({ type: 'unsatisfiable' });
  });
  it('ignores malformed or multi-range headers', () => {
    expect(parseRangeHeader('bytes=0-9,20-29', 100)).toEqual({ type: 'full' });
    expect(parseRangeHeader('items=0-9', 100)).toEqual({ type: 'full' });
    expect(parseRangeHeader('bytes=-', 100)).toEqual({ type: 'full' });
    expect(parseRangeHeader('bytes=abc', 100)).toEqual({ type: 'full' });
  });
});
