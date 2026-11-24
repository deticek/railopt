import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlacePickerComponent } from '../place-picker/place-picker';
import {
  findFreightTerminals,
  updateSavedDeliveryPlan,
  type DeliveryOption,
  type DeliveryPlanInput,
  type PlaceSelection,
  type SavedDeliveryPlan,
} from '../../core/api/delivery-plans-api';

@Component({
  selector: 'app-delivery-plan-details',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, PlacePickerComponent],
  templateUrl: './delivery-plan-details.html',
  styleUrl: './delivery-plan-details.scss',
})
export class DeliveryPlanDetailsComponent {
  @Input({ required: true }) plan!: SavedDeliveryPlan;
  @Input() preferFastest = false;
  @Input() readOnly = false;
  @Output() planSaved = new EventEmitter<SavedDeliveryPlan>();
  editInput: DeliveryPlanInput | null = null;
  editing = false;
  saving = false;
  findingTerminals = false;
  error = '';
  preferredOptionId = '';

  get options(): DeliveryOption[] {
    return Array.isArray(this.plan.result?.options) ? this.plan.result.options : [];
  }

  get hasCombinedOption(): boolean {
    return this.options.some((option) => option.id !== 'road');
  }

  get fastestOption(): DeliveryOption | null {
    return fastestDeliveryOption(this.options);
  }

  get selectedOption(): DeliveryOption | null {
    if (this.preferFastest) return this.fastestOption;
    const result = this.plan.result;
    return (
      this.options.find((option) => option.id === result.selectedOptionId) ||
      this.options.find((option) => option.id === result.recommendedOptionId) ||
      this.options[0] ||
      null
    );
  }

  get statusOnTime(): boolean {
    return this.preferFastest
      ? (this.selectedOption?.onTime ?? this.plan.result.onTime)
      : this.plan.result.onTime;
  }

  isSelected(option: DeliveryOption): boolean {
    return option.id === (this.editing ? this.preferredOptionId : this.selectedOption?.id);
  }

  chooseOption(option: DeliveryOption): void {
    this.preferredOptionId = option.id;
    if (this.editInput) this.editInput.transportMode = option.id === 'road' ? 'road' : 'compare';
  }

  setTransportMode(mode: 'road' | 'compare'): void {
    if (!this.editInput) return;
    this.editInput.transportMode = mode;
    this.preferredOptionId =
      mode === 'road' ? 'road' : this.combinedOptionId(this.editInput.unitType);
  }

  async setUnitType(unitType: string): Promise<void> {
    const input = this.editInput;
    if (!input) return;
    input.unitType = unitType;
    if (input.transportMode === 'compare') this.preferredOptionId = this.combinedOptionId(unitType);
    input.terminalOrigin = null;
    input.terminalDestination = null;
    this.findingTerminals = true;
    try {
      const rolaOnly = isRoLaUnit(unitType);
      const [origins, destinations] = await Promise.all([
        findFreightTerminals(input.origin, rolaOnly),
        findFreightTerminals(input.destination, rolaOnly),
      ]);
      if (this.editInput !== input || input.unitType !== unitType) return;
      input.terminalOrigin = origins[0] ? terminalSelection(origins[0]) : null;
      input.terminalDestination = destinations[0] ? terminalSelection(destinations[0]) : null;
    } catch (error) {
      input.terminalOrigin = null;
      input.terminalDestination = null;
      this.error =
        error instanceof Error ? error.message : 'Tovornih terminalov ni bilo mogoče poiskati.';
    } finally {
      this.findingTerminals = false;
    }
  }

  private combinedOptionId(unitType: string): string {
    return /nedvigljiv|ponjav|tovornjak/i.test(unitType) ? 'rola' : 'rail';
  }

  warnings(option: DeliveryOption): string[] {
    return [...new Set([...(this.plan.result.warnings || []), ...(option.warnings || [])])];
  }

  duration(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? (remainder ? `${hours} h ${remainder} min` : `${hours} h`) : `${remainder} min`;
  }

  beginEdit(): void {
    if (this.readOnly) return;
    const saved = this.plan.input;
    const selectedOptionId = this.selectedOption?.id;
    const unitType = saved?.unitType || this.plan.unitType;
    const transportMode =
      saved?.transportMode ||
      (selectedOptionId && selectedOptionId !== 'road' ? 'compare' : 'road');
    this.preferredOptionId = transportMode === 'compare' ? this.combinedOptionId(unitType) : 'road';
    this.editInput = {
      ...saved,
      origin: normalizePlace(saved?.origin, this.plan.origin),
      destination: normalizePlace(saved?.destination, this.plan.destination),
      loadingAt: saved?.loadingAt || this.plan.loadingAt,
      deliveryDeadlineAt: saved?.deliveryDeadlineAt || this.plan.deadlineAt,
      weightKg: Number(saved?.weightKg ?? this.plan.weightKg),
      unitType,
      loadingWindowStart: saved?.loadingWindowStart || '07:00',
      loadingWindowEnd: saved?.loadingWindowEnd || '11:00',
      unloadingWindowStart: saved?.unloadingWindowStart || '07:00',
      unloadingWindowEnd: saved?.unloadingWindowEnd || '15:00',
      extraTimeMinutes: Number(saved?.extraTimeMinutes ?? this.plan.result.extraTimeMinutes ?? 0),
      transportMode,
      preference: saved?.preference || 'cost',
      roLaTicketEur: Number(saved?.roLaTicketEur ?? this.selectedOption?.cost.railTicketEur ?? 0),
      adr: Boolean(saved?.adr ?? this.plan.result.adr),
      weekendBan: saved?.weekendBan !== false,
      costMode: saved?.costMode === 'detailed' ? 'detailed' : 'excel',
      costs: {
        ...(saved?.costs || {}),
        fuelPricePerLitre: Number(saved?.costs?.fuelPricePerLitre ?? 1.55),
        fuelConsumptionLPer100Km: Number(saved?.costs?.fuelConsumptionLPer100Km ?? 30),
        driverCostPerHour: Number(saved?.costs?.driverCostPerHour ?? 18),
        tollsEur: Number(saved?.costs?.tollsEur ?? 0),
        customsEur: Number(saved?.costs?.customsEur ?? 0),
        otherVehicleEur: Number(saved?.costs?.otherVehicleEur ?? 0),
      },
    };
    this.error = '';
    this.editing = true;
  }

  cancelEdit(): void {
    this.editing = false;
    this.editInput = null;
    this.error = '';
  }

  async setLocation(side: 'origin' | 'destination', place: PlaceSelection | null): Promise<void> {
    if (!this.editInput || !place) return;
    this.editInput[side] = place;
    this.findingTerminals = true;
    this.error = '';
    try {
      const terminal =
        (await findFreightTerminals(place, isRoLaUnit(this.editInput.unitType)))[0] || null;
      this.editInput[side === 'origin' ? 'terminalOrigin' : 'terminalDestination'] = terminal
        ? {
            label: terminal.label,
            lat: terminal.lat,
            lon: terminal.lon,
            countryCode: terminal.countryCode,
          }
        : null;
    } catch (error) {
      this.editInput[side === 'origin' ? 'terminalOrigin' : 'terminalDestination'] = null;
      this.error =
        error instanceof Error ? error.message : 'Tovornih terminalov ni bilo mogoče poiskati.';
    } finally {
      this.findingTerminals = false;
    }
  }

  async saveEdit(): Promise<void> {
    const input = this.editInput;
    if (this.readOnly || !input || this.saving || this.findingTerminals) return;
    this.saving = true;
    this.error = '';
    try {
      if (!input.terminalOrigin || !input.terminalDestination) {
        try {
          const [origins, destinations] = await Promise.all([
            findFreightTerminals(input.origin, isRoLaUnit(input.unitType)),
            findFreightTerminals(input.destination, isRoLaUnit(input.unitType)),
          ]);
          input.terminalOrigin =
            input.terminalOrigin || (origins[0] ? terminalSelection(origins[0]) : null);
          input.terminalDestination =
            input.terminalDestination ||
            (destinations[0] ? terminalSelection(destinations[0]) : null);
        } catch (error) {
          if (input.transportMode === 'compare') throw error;
        }
      }
      if (
        input.transportMode === 'compare' &&
        (!input.terminalOrigin || !input.terminalDestination)
      ) {
        throw new Error('Za primerjavo z vlakom ni mogoče najti obeh tovornih terminalov.');
      }
      const selectedOptionId = this.preferredOptionId || this.selectedOption?.id || 'road';
      const updated = await updateSavedDeliveryPlan(this.plan.id, input, selectedOptionId);
      this.plan = updated;
      this.editing = false;
      this.editInput = null;
      this.planSaved.emit(updated);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Relacije ni bilo mogoče shraniti.';
    } finally {
      this.saving = false;
    }
  }
}

export function fastestDeliveryOption(options: DeliveryOption[]): DeliveryOption | null {
  return options.reduce<DeliveryOption | null>((fastest, option) => {
    if (!fastest) return option;
    const arrival = Date.parse(option.deliveryAt);
    const fastestArrival = Date.parse(fastest.deliveryAt);
    return Number.isFinite(arrival) &&
      (!Number.isFinite(fastestArrival) || arrival < fastestArrival)
      ? option
      : fastest;
  }, null);
}

function normalizePlace(place: PlaceSelection | null | undefined, label: string): PlaceSelection {
  return {
    label: place?.label || label,
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    countryCode: place?.countryCode || null,
    state: place?.state || null,
  };
}

function terminalSelection(place: PlaceSelection): PlaceSelection {
  return { label: place.label, lat: place.lat, lon: place.lon, countryCode: place.countryCode };
}

function isRoLaUnit(unitType: string): boolean {
  return /tovornjak|nedvigljiv|ponjav/i.test(unitType);
}
