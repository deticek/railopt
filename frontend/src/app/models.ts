export type Shipment = {
  id: string | number;
  routeId: string | number;
  code: string;
  route: string;
  status: string;
  mode: string;
  date: string;
  deliveryDateRaw: string;
  loadingDate: string;
  recipientDeadline: string;
  weightKg: number | null;
  unitType: string;
  adr: boolean;
  extraTimeMinutes: number;
  routeExtraTimeMinutes: number;
  calculatedDeliveryAt: string | null;
  cost: string;
  co2: string;
};

export type Route = {
  id: number | string;
  code: string;
  direction: string;
  from: string;
  to: string;
  loadingCountry: string;
  loadingPostalCode: string;
  loadingCity: string;
  unloadingCountry: string;
  unloadingPostalCode: string;
  unloadingCity: string;
  roadDistanceKm: number;
  unitType: string;
  shipments: number;
  shipmentsCount: number | null;
  averageTrucksPerWeek: number | null;
  loadingWindowStart: string;
  loadingWindowEnd: string;
  unloadingWindowStart: string;
  unloadingWindowEnd: string;
  cargoGroup: string | null;
  note: string | null;
  extraTimeMinutes: number;
};

export const roadCo2eKgPerTkm = 0.095;

export function calculateRoadCo2e(
  weightKg: number,
  distanceKm: number,
  factor = roadCo2eKgPerTkm,
): { tkm: number; kgCo2e: number; kgPerTkm: number } | null {
  if (
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    !Number.isFinite(distanceKm) ||
    distanceKm <= 0 ||
    !Number.isFinite(factor) ||
    factor < 0
  )
    return null;
  const tkm = (weightKg / 1000) * distanceKm;
  return { tkm, kgCo2e: tkm * factor, kgPerTkm: factor };
}

export function formatMoney(value: number | null | undefined): string {
  return value == null
    ? '—'
    : new Intl.NumberFormat('sl-SI', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(value);
}

export function formatDate(value: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('sl-SI', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

export function routeLabel(from: string, to: string): string {
  return `${from.trim()} → ${to.trim()}`;
}
