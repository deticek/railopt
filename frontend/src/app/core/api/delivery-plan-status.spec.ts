import { describe, expect, it } from 'vitest';
import { isCompletedDeliveryPlan, isPendingDeliveryPlan } from './delivery-plan-status';

describe('delivery plan status', () => {
  const now = new Date('2026-11-24T10:00:00').getTime();

  it('keeps plans with a future arrival in the active list', () => {
    const plan = {
      deadlineAt: '2026-11-24T11:00:00',
      result: { deliveryAt: '2026-11-24T10:30:00' },
    };
    expect(isPendingDeliveryPlan(plan, now)).toBe(true);
    expect(isCompletedDeliveryPlan(plan, now)).toBe(false);
  });

  it('moves plans with a past arrival to history', () => {
    const plan = {
      deadlineAt: '2026-11-24T09:00:00',
      result: { deliveryAt: '2026-11-24T09:30:00' },
    };
    expect(isCompletedDeliveryPlan(plan, now)).toBe(true);
    expect(isPendingDeliveryPlan(plan, now)).toBe(false);
  });

  it('uses the saved deadline if a legacy result has no arrival', () => {
    expect(isCompletedDeliveryPlan({ deadlineAt: '2026-11-24T09:00:00' }, now)).toBe(true);
    expect(isPendingDeliveryPlan({ deadlineAt: 'invalid' }, now)).toBe(true);
  });
});
