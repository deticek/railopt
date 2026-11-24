import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { DeliveryPlanDetailsComponent } from './delivery-plan-details';
import type { DeliveryOption, DeliveryPlanInput, DeliveryPlanResult, SavedDeliveryPlan } from '../../core/api/delivery-plans-api';

describe('DeliveryPlanDetailsComponent inline editor', () => {
  it('prefills editable controls with the saved planner values', () => {
    const origin = { label: 'Ljubljana', lat: 46.0569, lon: 14.5058, countryCode: 'SI' };
    const destination = { label: 'Graz', lat: 47.0707, lon: 15.4395, countryCode: 'AT' };
    const input: DeliveryPlanInput = {
      origin,
      destination,
      terminalOrigin: null,
      terminalDestination: null,
      loadingAt: '2026-12-01T08:30',
      deliveryDeadlineAt: '2026-12-03T16:00',
      loadingWindowStart: '06:30',
      loadingWindowEnd: '10:30',
      unloadingWindowStart: '08:00',
      unloadingWindowEnd: '17:00',
      weightKg: 12500,
      unitType: 'P400 – dvigljiva prikolica',
      extraTimeMinutes: 75,
      globalExtraTimeMinutes: 15,
      transportMode: 'compare',
      preference: 'emissions',
      roLaTicketEur: 340,
      adr: true,
      weekendBan: false,
      costMode: 'detailed',
      costs: {
        fuelPricePerLitre: 1.72,
        fuelConsumptionLPer100Km: 29,
        driverCostPerHour: 24,
        tollsEur: 125,
        customsEur: 12,
        otherVehicleEur: 18
      }
    };
    const result = {
      origin,
      destination,
      weightKg: input.weightKg,
      unitType: input.unitType,
      extraTimeMinutes: input.extraTimeMinutes,
      adr: input.adr,
      options: [makeOption('road'), makeOption('rail')],
      selectedOptionId: 'road'
    } as DeliveryPlanResult;
    const plan = {
      id: 'plan-id',
      origin: origin.label,
      destination: destination.label,
      loadingAt: input.loadingAt,
      deadlineAt: input.deliveryDeadlineAt,
      weightKg: input.weightKg,
      unitType: input.unitType,
      input,
      result
    } as SavedDeliveryPlan;
    const component = new DeliveryPlanDetailsComponent();
    component.plan = plan;

    component.beginEdit();

    expect(component.editing).toBe(true);
    expect(component.preferredOptionId).toBe('rail');
    expect(component.editInput).toMatchObject({
      origin,
      destination,
      loadingAt: input.loadingAt,
      deliveryDeadlineAt: input.deliveryDeadlineAt,
      weightKg: 12500,
      unitType: input.unitType,
      extraTimeMinutes: 75,
      transportMode: 'compare',
      preference: 'emissions',
      roLaTicketEur: 340,
      loadingWindowStart: '06:30',
      unloadingWindowEnd: '17:00',
      adr: true,
      weekendBan: false,
      costMode: 'detailed',
      costs: input.costs
    });
  });
  it('detects when a saved plan is missing the combined option', () => {
    const component = new DeliveryPlanDetailsComponent();
    component.plan = {
      result: { options: [makeOption('road')] }
    } as SavedDeliveryPlan;

    expect(component.hasCombinedOption).toBe(false);

    component.plan.result.options.push(makeOption('rail'));
    expect(component.hasCombinedOption).toBe(true);
  });
  it('uses the earliest arrival as the history default', () => {
    const road = makeOption('road');
    road.deliveryAt = '2026-12-03T16:00:00';
    road.onTime = false;
    const rail = makeOption('rail');
    rail.deliveryAt = '2026-12-03T12:00:00';
    const component = new DeliveryPlanDetailsComponent();
    component.plan = {
      result: {
        selectedOptionId: 'road',
        recommendedOptionId: 'road',
        onTime: false,
        options: [road, rail]
      }
    } as SavedDeliveryPlan;
    component.preferFastest = true;

    expect(component.selectedOption?.id).toBe('rail');
    expect(component.isSelected(rail)).toBe(true);
    expect(component.statusOnTime).toBe(true);
  });
  it('does not open the editor in read-only history details', () => {
    const component = new DeliveryPlanDetailsComponent();
    component.readOnly = true;

    component.beginEdit();

    expect(component.editing).toBe(false);
    expect(component.editInput).toBeNull();
  });
  it('switches between road and combined transport for truck units', () => {
    const origin = { label: 'Ljubljana', lat: 46.0569, lon: 14.5058, countryCode: 'SI' };
    const destination = { label: 'Graz', lat: 47.0707, lon: 15.4395, countryCode: 'AT' };
    const component = new DeliveryPlanDetailsComponent();
    component.plan = {
      id: 'plan-id',
      origin: origin.label,
      destination: destination.label,
      loadingAt: '2026-12-01T08:30',
      deadlineAt: '2026-12-03T16:00',
      weightKg: 12500,
      unitType: 'P400 – dvigljiva prikolica',
      input: {
        origin,
        destination,
        loadingAt: '2026-12-01T08:30',
        deliveryDeadlineAt: '2026-12-03T16:00',
        weightKg: 12500,
        unitType: 'P400 – dvigljiva prikolica',
        transportMode: 'compare'
      },
      result: {
        origin,
        destination,
        weightKg: 12500,
        unitType: 'P400 – dvigljiva prikolica',
        extraTimeMinutes: 0,
        adr: false,
        selectedOptionId: 'rail',
        recommendedOptionId: 'rail',
        options: [makeOption('rail')]
      }
    } as SavedDeliveryPlan;
    component.beginEdit();

    component.setTransportMode('compare');
    expect(component.editInput?.transportMode).toBe('compare');
    expect(component.preferredOptionId).toBe('rail');
    expect(component.isSelected(makeOption('rail'))).toBe(true);

    component.chooseOption(makeOption('road'));

    expect(component.editInput?.transportMode).toBe('road');
    expect(component.preferredOptionId).toBe('road');

    component.chooseOption(makeOption('rail'));
    expect(component.editInput?.transportMode).toBe('compare');
    component.setUnitType('Tovornjak – samo cesta');
    expect(component.editInput?.transportMode).toBe('compare');
    expect(component.preferredOptionId).toBe('rola');
  });
});

function makeOption(id: string): DeliveryOption {
  return {
    id,
    title: id === 'road' ? 'Samo cesta' : 'Železnica',
    mode: id,
    distanceKm: 500,
    roadKm: 500,
    railKm: id === 'road' ? 0 : 200,
    cost: { mode: 'excel', totalEur: 100 },
    emissionsKgCo2e: 25,
    deliveryAt: '2026-12-03T16:00:00',
    totalElapsedHours: 8,
    drivingHours: 7,
    breakCount: 1,
    dailyRestCount: 0,
    onTime: true,
    feasible: true,
    warnings: [],
    timeline: []
  };
}
