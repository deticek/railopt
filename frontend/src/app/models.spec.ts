import { describe, expect, it } from 'vitest';
import { calculateRoadCo2e, formatDate, formatMoney, roadCo2eKgPerTkm, routeLabel } from './models';

describe('Railopt display helpers', () => {
  it('formats money with the Slovenian locale', () => {
    expect(formatMoney(1240).replace(/\s/g, '')).toContain('1240€');
    expect(formatMoney(null)).toBe('—');
  });

  it('formats dates without shifting the calendar day', () => {
    expect(formatDate('2026-11-23')).toContain('23.');
    expect(formatDate('')).toBe('—');
  });

  it('joins route endpoints consistently', () => {
    expect(routeLabel(' Ljubljana ', 'München ')).toBe('Ljubljana → München');
  });

  it('calculates road WTW emissions in ton-kilometres', () => {
    expect(calculateRoadCo2e(24000, 500)).toEqual({ tkm: 12000, kgCo2e: 1140, kgPerTkm: roadCo2eKgPerTkm });
    expect(calculateRoadCo2e(0, 500)).toBeNull();
    expect(roadCo2eKgPerTkm).toBe(0.095);
  });
});
