export interface DeliveryPlanSchedule {
  deadlineAt?: string | null;
  result?: { deliveryAt?: string | null } | null;
}

export function isCompletedDeliveryPlan(plan: DeliveryPlanSchedule, now = Date.now()): boolean {
  const arrival = new Date(plan.result?.deliveryAt || plan.deadlineAt || '').getTime();
  return Number.isFinite(arrival) && arrival < now;
}

export function isPendingDeliveryPlan(plan: DeliveryPlanSchedule, now = Date.now()): boolean {
  return !isCompletedDeliveryPlan(plan, now);
}
