import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlacePickerComponent } from '../place-picker/place-picker';
import {
  findFreightTerminals,
  updateSavedDeliveryPlan,
  estimateDeliveryPlan,
  type DeliveryOption,
  type DeliveryPlanInput,
  type PlaceSelection,
  type RouteMapPoint,
  type RouteMapSegment,
  type SavedDeliveryPlan,
} from '../../core/api/delivery-plans-api';
import { RouteMapComponent } from '../route-map';

@Component({
  selector: 'app-delivery-plan-details',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, PlacePickerComponent, RouteMapComponent],
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
  recalculating = false;
  private previewSequence = 0;

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

  routeSegments(option: DeliveryOption): RouteMapSegment[] {
    if (option.routeSegments?.length) return option.routeSegments;
    const origin = this.plan.input?.origin;
    const destination = this.plan.input?.destination;
    const originTerminal = this.plan.input?.terminalOrigin;
    const destinationTerminal = this.plan.input?.terminalDestination;
    const valid = (point: PlaceSelection | null | undefined): point is PlaceSelection & { lat: number; lon: number } =>
      point?.lat != null && point.lon != null && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon));
    if (!valid(origin) || !valid(destination)) return [];
    const roadSegment = (label: string, from: PlaceSelection, to: PlaceSelection): RouteMapSegment => ({
      mode: 'road', label, coordinates: [[Number(from.lat), Number(from.lon)], [Number(to.lat), Number(to.lon)]],
    });
    if (option.id === 'road' || !valid(originTerminal) || !valid(destinationTerminal))
      return [roadSegment(option.id === 'road' ? 'Cestna pot (povezovalna črta)' : 'Cestna pot (ocena)', origin, destination)];
    return [
      roadSegment('Tovornjak do terminala', origin, originTerminal),
      { mode: 'rail', label: 'Železniški del (terminala)', coordinates: [[Number(originTerminal.lat), Number(originTerminal.lon)], [Number(destinationTerminal.lat), Number(destinationTerminal.lon)]] },
      roadSegment('Tovornjak od terminala do cilja', destinationTerminal, destination),
    ];
  }

  routePoints(option: DeliveryOption): RouteMapPoint[] {
    if (option.routePoints?.length) return option.routePoints;
    const segments = this.routeSegments(option);
    const coords = segments.flatMap(segment => segment.coordinates);
    const origin = this.plan.input?.origin;
    const destination = this.plan.input?.destination;
    if (coords.length < 2) return [];
    return [
      { label: origin?.label || this.plan.origin, lat: coords[0][0], lon: coords[0][1], kind: 'origin' },
      { label: destination?.label || this.plan.destination, lat: coords.at(-1)![0], lon: coords.at(-1)![1], kind: 'destination' },
    ];
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
    if (this.editInput) {
      const mode = option.id === 'road' ? 'ROAD' : option.id === 'rail' ? 'INTERMODAL' : 'RO_LA';
      this.setTransportMode(mode);
    }
  }

  setTransportMode(mode: 'ROAD' | 'INTERMODAL' | 'RO_LA'): void {
    if (!this.editInput) return;
    const input = this.editInput;
    input.selectedTransportMode = mode;
    input.transportMode = mode === 'ROAD' ? 'road' : 'compare';
    this.preferredOptionId = mode === 'ROAD' ? 'road' : mode === 'INTERMODAL' ? 'rail' : 'rola';
    void this.refreshModeCalculation(input);
  }

  get intermodalAvailable(): boolean { return Boolean(this.editInput && isLiftableUnit(this.editInput.unitType)); }
  get rolaAvailable(): boolean { return Boolean(this.editInput && isRoLaUnit(this.editInput.unitType)); }

  private async refreshModeCalculation(input: DeliveryPlanInput): Promise<void> {
    const sequence = ++this.previewSequence;
    this.recalculating = true;
    this.error = '';
    try {
      const { result } = await estimateDeliveryPlan(input);
      if (sequence !== this.previewSequence || this.editInput !== input) return;
      const chosen = result.options.find(option => option.id === this.preferredOptionId)
        || result.options[0];
      this.preferredOptionId = chosen?.id || '';
      this.plan = { ...this.plan, result: { ...result, selectedOptionId: chosen?.id } };
    } catch (error) {
      if (sequence === this.previewSequence)
        this.error = error instanceof Error ? error.message : 'Izračuna izbrane možnosti ni bilo mogoče osvežiti.';
    } finally {
      if (sequence === this.previewSequence) this.recalculating = false;
    }
  }

  async setUnitType(unitType: string): Promise<void> {
    const input = this.editInput;
    if (!input) return;
    input.unitType = unitType;
    if (input.selectedTransportMode === 'INTERMODAL' && !isLiftableUnit(unitType)) {
      input.selectedTransportMode = isRoLaUnit(unitType) ? 'RO_LA' : 'ROAD';
    } else if (input.selectedTransportMode === 'RO_LA' && !isRoLaUnit(unitType)) {
      input.selectedTransportMode = isLiftableUnit(unitType) ? 'INTERMODAL' : 'ROAD';
    }
    input.transportMode = input.selectedTransportMode === 'ROAD' ? 'road' : 'compare';
    this.preferredOptionId = input.selectedTransportMode === 'ROAD' ? 'road' : input.selectedTransportMode === 'INTERMODAL' ? 'rail' : 'rola';
    input.terminalOrigin = null;
    input.terminalDestination = null;
    this.findingTerminals = true;
    try {
      const rolaOnly = isRoLaUnit(unitType);
      const [origins, destinations] = await Promise.all([
        findFreightTerminals(input.origin, rolaOnly, input.unitType),
        findFreightTerminals(input.destination, rolaOnly, input.unitType),
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
    await this.refreshModeCalculation(input);
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
    const storedMode = saved?.selectedTransportMode;
    let selectedTransportMode = (storedMode === 'ROAD' || storedMode === 'INTERMODAL' || storedMode === 'RO_LA') ? storedMode :
      (selectedOptionId === 'rola' ? 'RO_LA' : selectedOptionId === 'rail' ? 'INTERMODAL' : transportMode === 'road' ? 'ROAD' : isRoLaUnit(unitType) ? 'RO_LA' : 'INTERMODAL');
    if(selectedTransportMode==='INTERMODAL'&&!isLiftableUnit(unitType))selectedTransportMode=isRoLaUnit(unitType)?'RO_LA':'ROAD';
    if(selectedTransportMode==='RO_LA'&&!isRoLaUnit(unitType))selectedTransportMode=isLiftableUnit(unitType)?'INTERMODAL':'ROAD';
    this.preferredOptionId = selectedTransportMode === 'ROAD' ? 'road' : selectedTransportMode === 'INTERMODAL' ? 'rail' : 'rola';
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
      selectedTransportMode,
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
        (await findFreightTerminals(place, isRoLaUnit(this.editInput.unitType), this.editInput.unitType))[0] || null;
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
            findFreightTerminals(input.origin, isRoLaUnit(input.unitType), input.unitType),
            findFreightTerminals(input.destination, isRoLaUnit(input.unitType), input.unitType),
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

function isLiftableUnit(unitType: string): boolean {
  return /p400|izmenljivi zaboj|zabojnik\s*(?:40|45)|zaboj\s*45|kontejner|swap/i.test(unitType);
}
