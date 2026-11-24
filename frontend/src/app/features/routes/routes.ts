import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  calculateShipment,
  compareShipment,
  getGlobalExtraTime,
  getRoutes,
  getShipments,
  saveGlobalExtraTime,
  saveShipmentExtraTime,
  updateRoute,
  updateShipment,
  type ShipmentComparisonOption,
} from '../../core/api/transport-api';
import { Route, Shipment } from '../../models';
import {
  estimateDeliveryPlan,
  findFreightTerminals,
  getSavedDeliveryPlan,
  listAllDeliveryPlans,
  SavedDeliveryPlan,
  updateSavedDeliveryPlan,
  type DeliveryOption,
  type DeliveryPlanInput,
  type DeliveryPlanResult,
  type PlaceSelection,
} from '../../core/api/delivery-plans-api';
import {
  isCompletedDeliveryPlan,
  isPendingDeliveryPlan,
} from '../../core/api/delivery-plan-status';
import { PlacePickerComponent } from '../../components/place-picker/place-picker';
import { DeliveryPlanDetailsComponent } from '../../components/delivery-plan-details/delivery-plan-details';

@Component({
  selector: 'app-routes',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, PlacePickerComponent, DeliveryPlanDetailsComponent],
  templateUrl: './routes.html',
  styleUrl: './routes.scss',
})
export class RoutesComponent implements OnInit {
  rows: Route[] = [];
  shipments: Shipment[] = [];
  plans: SavedDeliveryPlan[] = [];
  error = '';
  shipmentsUnavailable = false;
  plansUnavailable = false;
  message = '';
  loading = true;
  saving = '';
  globalExtraTimeMinutes = 0;
  editing: Route | null = null;
  editingShipment: Shipment | null = null;
  shipmentModePreview: Shipment | null = null;
  shipmentModePreviewBusy = false;
  shipmentModeBaseline: Shipment | null = null;
  shipmentComparison: ShipmentComparisonOption[] = [];
  selectedShipmentOptionId = '';
  editingPlan: SavedDeliveryPlan | null = null;
  planForm: DeliveryPlanInput | null = null;
  planExtraTimeMinutes = 0;
  planExtraTimeHours = 0;
  planExtraTimeRemainderMinutes = 0;
  planComparisonBusy = false;
  planLoadingId = '';
  expandedPlanId = '';
  shipmentEdits: Record<string, number> = {};
  shipmentModes: Record<string, 'AUTO' | 'ROAD' | 'INTERMODAL' | 'RO_LA'> = {};
  calculatingShipment = '';
  constructor(private readonly changeDetector: ChangeDetectorRef) {}

  get currentShipments(): Shipment[] {
    const now = Date.now();
    return this.shipments.filter(
      (row) =>
        new Date(`${row.loadingDate}T00:00:00`).getTime() <= now &&
        new Date(`${row.deliveryDateRaw}T23:59:59`).getTime() >= now,
    );
  }
  get futureShipments(): Shipment[] {
    return this.shipments.filter(
      (row) => new Date(`${row.loadingDate}T00:00:00`).getTime() > Date.now(),
    );
  }
  get activePlans(): SavedDeliveryPlan[] {
    return this.plans.filter((plan) => isPendingDeliveryPlan(plan));
  }
  get historicalPlans(): SavedDeliveryPlan[] {
    return this.plans.filter((plan) => isCompletedDeliveryPlan(plan));
  }
  togglePlanDetails(id: string): void {
    this.expandedPlanId = this.expandedPlanId === id ? '' : id;
  }
  replacePlan(updated: SavedDeliveryPlan): void {
    this.plans = this.plans.map((plan) => (plan.id === updated.id ? updated : plan));
    this.message = 'Načrtovana relacija je posodobljena in ponovno preračunana.';
    this.changeDetector.markForCheck();
  }
  shipmentStatus(row: Shipment): string {
    return new Date(`${row.loadingDate}T00:00:00`).getTime() <= Date.now()
      ? 'V teku'
      : 'Načrtovano';
  }
  shipmentArrival(row: Shipment): Date {
    const minutes =
      this.globalExtraTimeMinutes +
      row.routeExtraTimeMinutes +
      Number(this.shipmentEdits[row.id] ?? row.extraTimeMinutes);
    return new Date(new Date(`${row.deliveryDateRaw}T12:00:00`).getTime() + minutes * 60000);
  }
  isLiftable(row: Shipment): boolean {
    return /p400|izmenljivi zaboj|zabojnik 45/i.test(row.unitType);
  }
  isNonLiftable(row: Shipment): boolean {
    return !this.isLiftable(row) && !/samo cesta|tovornjak/i.test(row.unitType);
  }
  shipmentBusy(row: Shipment): boolean {
    return this.calculatingShipment === String(row.id);
  }
  plannedArrival(plan: SavedDeliveryPlan): Date {
    const change = this.globalExtraTimeMinutes - Number(plan.input.globalExtraTimeMinutes || 0);
    return new Date(new Date(plan.result.deliveryAt).getTime() + change * 60000);
  }
  editRoute(row: Route): void {
    this.editing = { ...row };
    this.message = '';
    this.error = '';
  }
  editShipment(row: Shipment): void {
    this.editingShipment = { ...row };
    this.shipmentModeBaseline = { ...row };
    this.shipmentModePreview = null;
    this.shipmentComparison = [];
    this.shipmentModes[row.id] =
      row.mode === 'Cestni'
        ? 'ROAD'
        : row.mode === 'RO-LA'
          ? 'RO_LA'
          : row.mode === 'Intermodalni'
            ? 'INTERMODAL'
            : 'AUTO';
    this.selectedShipmentOptionId =
      row.mode === 'Cestni'
        ? 'road'
        : row.mode === 'RO-LA'
          ? 'rola'
          : row.mode === 'Intermodalni'
            ? 'rail'
            : '';
    this.message = '';
    this.error = '';
    void this.loadShipmentComparison(row);
  }
  async loadShipmentComparison(row: Shipment): Promise<void> {
    this.shipmentModePreviewBusy = true;
    this.error = '';
    try {
      const comparison = await compareShipment(row.id);
      this.shipmentComparison = comparison.options;
      if (!this.selectedShipmentOptionId)
        this.selectedShipmentOptionId = comparison.recommendedOptionId || 'road';
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Primerjave prevozov ni bilo mogoče izračunati.';
    } finally {
      this.shipmentModePreviewBusy = false;
      this.changeDetector.markForCheck();
    }
  }
  selectShipmentOption(option: ShipmentComparisonOption, row: Shipment): void {
    this.selectedShipmentOptionId = option.id;
    this.shipmentModes[row.id] =
      option.id === 'road' ? 'ROAD' : option.id === 'rail' ? 'INTERMODAL' : 'RO_LA';
  }
  chooseShipmentMode(mode: 'ROAD' | 'INTERMODAL' | 'RO_LA', row: Shipment): void {
    const optionId = mode === 'ROAD' ? 'road' : mode === 'INTERMODAL' ? 'rail' : 'rola';
    const option = this.shipmentComparison.find((item) => item.id === optionId);
    if (option) this.selectShipmentOption(option, row);
  }
  shipmentOptionSelected(option: ShipmentComparisonOption, row: Shipment): boolean {
    return (
      option.id === this.selectedShipmentOptionId ||
      (!this.selectedShipmentOptionId && option.id === 'road')
    );
  }
  modeDifference(current: string, baseline: string): string {
    return current === baseline ? 'brez spremembe' : `${baseline} → ${current}`;
  }
  async saveShipmentDetails(): Promise<void> {
    if (!this.editingShipment || this.saving) return;
    this.saving = 'shipment-data';
    this.error = '';
    this.message = '';
    try {
      const shipment = this.editingShipment;
      const mode = this.shipmentModes[shipment.id] || 'AUTO';
      await updateShipment(shipment);
      await calculateShipment(shipment.id, mode);
      this.message = `Pošiljka ${shipment.code} je shranjena in ponovno izračunana.`;
      this.editingShipment = null;
      this.shipmentModePreview = null;
      this.shipmentModeBaseline = null;
      this.shipmentComparison = [];
      this.shipments = await getShipments();
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Podatkov pošiljke ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.changeDetector.markForCheck();
    }
  }
  async calculateOne(row: Shipment): Promise<void> {
    const key = String(row.id);
    this.calculatingShipment = key;
    this.error = '';
    this.message = '';
    try {
      await calculateShipment(row.id, this.shipmentModes[key] || 'AUTO');
      this.shipments = await getShipments();
      this.message = `Strošek, emisije in prihod pošiljke ${row.code} so posodobljeni.`;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Izračun pošiljke ni uspel.';
    } finally {
      this.calculatingShipment = '';
      this.changeDetector.markForCheck();
    }
  }
  async editPlan(plan: SavedDeliveryPlan): Promise<void> {
    this.editingPlan = null;
    this.planForm = null;
    this.error = '';
    this.message = '';
    this.planLoadingId = plan.id;
    try {
      this.populatePlanForEditing(await getSavedDeliveryPlan(plan.id));
    } catch (error) {
      this.populatePlanForEditing(plan);
      const detail = error instanceof Error ? ` ${error.message}` : '';
      this.error = `Podatkov ni bilo mogoče znova naložiti; prikazani so že naloženi podatki načrta.${detail}`;
    } finally {
      this.planLoadingId = '';
      this.changeDetector.markForCheck();
    }
  }
  private populatePlanForEditing(plan: SavedDeliveryPlan): void {
    // Work from a fresh object so Angular's form model always gets a writable
    // value, even when API rows contain omitted/null legacy JSON columns.
    const copy = { ...plan } as SavedDeliveryPlan;
    // Older saved rows may have their inputs split across the JSON payload,
    // calculated result, and normalized database columns. Merge those sources
    // so the edit form is populated even for plans saved by earlier versions.
    const saved = asRecord(copy.input);
    const calculated = asRecord(copy.result) as Partial<DeliveryPlanResult>;
    const raw = {
      ...asRecord(saved['input']),
      ...asRecord(asRecord(copy.result)['input']),
      ...saved,
    } as Partial<DeliveryPlanInput>;
    const selectedOptionId = copy.result?.selectedOptionId || copy.result?.recommendedOptionId;
    const resultOptions = Array.isArray(calculated.options) ? calculated.options : [];
    const selectedOption =
      resultOptions.find((option) => option.id === selectedOptionId) || resultOptions[0];
    const origin = normalizePlace(
      raw.origin || calculated?.origin,
      copy.origin || calculated?.origin?.label || '',
    );
    const destination = normalizePlace(
      raw.destination || calculated?.destination,
      copy.destination || calculated?.destination?.label || '',
    );
    const globalExtra = Number(raw.globalExtraTimeMinutes ?? 0);
    const input: DeliveryPlanInput = {
      origin,
      destination,
      terminalOrigin: raw.terminalOrigin || null,
      terminalDestination: raw.terminalDestination || null,
      loadingAt: localDateTimeInput(
        raw.loadingAt ||
          calculated.requestedLoadingAt ||
          copy.loadingAt ||
          calculated.actualLoadingAt,
      ),
      deliveryDeadlineAt: localDateTimeInput(
        raw.deliveryDeadlineAt || copy.deadlineAt || calculated.deadlineAt,
      ),
      loadingWindowStart: raw.loadingWindowStart || '07:00',
      loadingWindowEnd: raw.loadingWindowEnd || '11:00',
      unloadingWindowStart: raw.unloadingWindowStart || '07:00',
      unloadingWindowEnd: raw.unloadingWindowEnd || '15:00',
      weightKg: Number(raw.weightKg ?? calculated.weightKg ?? copy.weightKg ?? 1),
      unitType: String(
        raw.unitType || calculated.unitType || copy.unitType || 'Tovornjak – samo cesta',
      ),
      extraTimeMinutes: Number(raw.extraTimeMinutes ?? calculated.extraTimeMinutes ?? 0),
      globalExtraTimeMinutes: globalExtra,
      transportMode:
        raw.transportMode === 'compare' ||
        selectedOption?.id === 'rail' ||
        selectedOption?.id === 'rola'
          ? 'compare'
          : 'road',
      preference:
        raw.preference === 'time' || raw.preference === 'emissions'
          ? raw.preference
          : calculated.preference === 'time' || calculated.preference === 'emissions'
            ? calculated.preference
            : 'cost',
      roLaTicketEur: Number(raw.roLaTicketEur ?? selectedOption?.cost?.railTicketEur ?? 0),
      adr: Boolean(raw.adr ?? calculated.adr),
      weekendBan: raw.weekendBan !== false,
      costMode: raw.costMode === 'detailed' || copy.costMode === 'detailed' ? 'detailed' : 'excel',
      costs: {
        fuelPricePerLitre: 1.55,
        fuelConsumptionLPer100Km: 30,
        driverCostPerHour: 18,
        tollsEur: 0,
        customsEur: 0,
        otherVehicleEur: 0,
        ...(raw.costs || {}),
      },
    };
    copy.input = input;
    copy.result = {
      ...calculated,
      origin,
      destination,
      options: resultOptions,
      selectedOptionId: selectedOptionId || undefined,
    } as DeliveryPlanResult;
    this.editingPlan = copy;
    this.planForm = input;
    this.planExtraTimeMinutes = Math.max(0, Number(input.extraTimeMinutes || 0) - globalExtra);
    this.planExtraTimeHours = Math.floor(this.planExtraTimeMinutes / 60);
    this.planExtraTimeRemainderMinutes = this.planExtraTimeMinutes % 60;
    this.error = '';
    this.message = '';
    this.planComparisonBusy = true;
    this.changeDetector.detectChanges();
    // Rebuild comparison cards from the populated saved values immediately,
    // including older plans that were stored before route options were saved.
    void this.loadPlanComparison();
  }
  async loadPlanComparison(): Promise<void> {
    const plan = this.editingPlan;
    const input = this.planForm;
    if (!plan || !input) return;
    try {
      const previous = plan.result.selectedOptionId;
      const truckOnly = /tovornjak.*samo cesta/i.test(input.unitType);
      const rolaOnly = /tovornjak|nedvigljiv|ponjav/i.test(input.unitType);
      if (!truckOnly && (!input.terminalOrigin || !input.terminalDestination)) {
        const [originTerminals, destinationTerminals] = await Promise.all([
          findFreightTerminals(input.origin, rolaOnly),
          findFreightTerminals(input.destination, rolaOnly),
        ]);
        input.terminalOrigin = originTerminals[0]
          ? {
              label: originTerminals[0].label,
              lat: originTerminals[0].lat,
              lon: originTerminals[0].lon,
              countryCode: originTerminals[0].countryCode,
            }
          : null;
        input.terminalDestination = destinationTerminals[0]
          ? {
              label: destinationTerminals[0].label,
              lat: destinationTerminals[0].lat,
              lon: destinationTerminals[0].lon,
              countryCode: destinationTerminals[0].countryCode,
            }
          : null;
      }
      const comparison = await estimateDeliveryPlan({
        ...input,
        transportMode: truckOnly ? 'road' : 'compare',
      });
      plan.result = {
        ...comparison.result,
        selectedOptionId: comparison.result.options.some((option) => option.id === previous)
          ? previous
          : comparison.result.recommendedOptionId || comparison.result.options[0]?.id,
      };
      input.transportMode = truckOnly ? 'road' : 'compare';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Primerjava ceste in Ro-La ni uspela.';
    } finally {
      this.planComparisonBusy = false;
      this.changeDetector.markForCheck();
    }
  }
  async refreshPlanComparison(): Promise<void> {
    if (!this.editingPlan) return;
    this.planComparisonBusy = true;
    await this.loadPlanComparison();
  }
  selectPlanOption(plan: SavedDeliveryPlan, option: DeliveryOption): void {
    plan.result.selectedOptionId = option.id;
  }
  setPlanInputValue(
    field: Exclude<
      keyof DeliveryPlanInput,
      | 'origin'
      | 'destination'
      | 'terminalOrigin'
      | 'terminalDestination'
      | 'costs'
      | 'adr'
      | 'weekendBan'
    >,
    value: string | number,
  ): void {
    if (!this.planForm) return;
    switch (field) {
      case 'weightKg':
        this.planForm.weightKg = Number(value);
        break;
      case 'extraTimeMinutes':
        this.planForm.extraTimeMinutes = Number(value);
        break;
      case 'globalExtraTimeMinutes':
        this.planForm.globalExtraTimeMinutes = Number(value);
        break;
      case 'roLaTicketEur':
        this.planForm.roLaTicketEur = Number(value);
        break;
      case 'loadingAt':
        this.planForm.loadingAt = String(value);
        break;
      case 'deliveryDeadlineAt':
        this.planForm.deliveryDeadlineAt = String(value);
        break;
      case 'loadingWindowStart':
        this.planForm.loadingWindowStart = String(value);
        break;
      case 'loadingWindowEnd':
        this.planForm.loadingWindowEnd = String(value);
        break;
      case 'unloadingWindowStart':
        this.planForm.unloadingWindowStart = String(value);
        break;
      case 'unloadingWindowEnd':
        this.planForm.unloadingWindowEnd = String(value);
        break;
      case 'unitType':
        this.planForm.unitType = String(value);
        this.planForm.terminalOrigin = null;
        this.planForm.terminalDestination = null;
        if (!/tovornjak.*samo cesta/i.test(this.planForm.unitType))
          void this.refreshPlanTerminals();
        break;
      case 'transportMode':
        this.planForm.transportMode = value === 'compare' ? 'compare' : 'road';
        break;
      case 'preference':
        this.planForm.preference = value === 'time' || value === 'emissions' ? value : 'cost';
        break;
      case 'costMode':
        this.planForm.costMode = value === 'detailed' ? 'detailed' : 'excel';
        break;
    }
  }
  setPlanCostValue(field: keyof DeliveryPlanInput['costs'], value: string | number): void {
    if (!this.planForm) return;
    this.planForm.costs[field] = Number(value);
  }
  setPlanExtraTime(part: 'hours' | 'minutes', rawValue: string | number): void {
    const value = Number(rawValue || 0);
    if (part === 'hours') this.planExtraTimeHours = value;
    else this.planExtraTimeRemainderMinutes = value;
  }
  setPlanCheckbox(field: 'adr' | 'weekendBan', checked: boolean): void {
    if (!this.planForm) return;
    this.planForm[field] = checked;
  }
  async setPlanLocation(
    side: 'origin' | 'destination',
    place: PlaceSelection | null,
  ): Promise<void> {
    const plan = this.editingPlan;
    const input = this.planForm;
    if (!plan || !input || !place) return;
    input[side] = place;
    plan.input = input;
    try {
      const terminal =
        (
          await findFreightTerminals(place, /tovornjak|nedvigljiv|ponjav/i.test(input.unitType))
        )[0] || null;
      input[side === 'origin' ? 'terminalOrigin' : 'terminalDestination'] = terminal
        ? {
            label: terminal.label,
            lat: terminal.lat,
            lon: terminal.lon,
            countryCode: terminal.countryCode,
          }
        : null;
    } catch {
      input[side === 'origin' ? 'terminalOrigin' : 'terminalDestination'] = null;
    }
  }
  private async refreshPlanTerminals(): Promise<void> {
    const input = this.planForm;
    if (!input) return;
    try {
      const rolaOnly = /tovornjak|nedvigljiv|ponjav/i.test(input.unitType);
      const [origins, destinations] = await Promise.all([
        findFreightTerminals(input.origin, rolaOnly),
        findFreightTerminals(input.destination, rolaOnly),
      ]);
      input.terminalOrigin = origins[0]
        ? {
            label: origins[0].label,
            lat: origins[0].lat,
            lon: origins[0].lon,
            countryCode: origins[0].countryCode,
          }
        : null;
      input.terminalDestination = destinations[0]
        ? {
            label: destinations[0].label,
            lat: destinations[0].lat,
            lon: destinations[0].lon,
            countryCode: destinations[0].countryCode,
          }
        : null;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Tovornih terminalov ni bilo mogoče poiskati.';
    }
  }
  async savePlan(): Promise<void> {
    if (!this.editingPlan || this.saving) return;
    this.saving = 'plan';
    this.error = '';
    this.message = '';
    try {
      const plan = this.editingPlan;
      const input = this.planForm;
      if (!input) throw new Error('Podatki za urejanje niso naloženi. Znova odpri relacijo.');
      const extraTimeMinutes =
        Number(this.planExtraTimeHours) * 60 + Number(this.planExtraTimeRemainderMinutes);
      const selectedOptionId =
        plan.result.selectedOptionId ||
        plan.result.recommendedOptionId ||
        plan.result.options[0]?.id ||
        'road';
      const transportMode = selectedOptionId === 'road' ? 'road' : 'compare';
      const updated = await updateSavedDeliveryPlan(
        plan.id,
        {
          ...input,
          transportMode,
          extraTimeMinutes: extraTimeMinutes + this.globalExtraTimeMinutes,
          globalExtraTimeMinutes: this.globalExtraTimeMinutes,
        },
        selectedOptionId,
      );
      this.plans = this.plans.map((plan) => (plan.id === updated.id ? updated : plan));
      this.editingPlan = null;
      this.planForm = null;
      this.message = 'Načrtovana relacija je preračunana in shranjena.';
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Načrtovane relacije ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.changeDetector.markForCheck();
    }
  }
  async saveRoute(): Promise<void> {
    if (!this.editing || this.saving) return;
    this.saving = 'route';
    this.error = '';
    this.message = '';
    try {
      await updateRoute(this.editing);
      this.message = `Relacija ${this.editing.code} je shranjena.`;
      this.editing = null;
      this.rows = await getRoutes();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Relacije ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.changeDetector.markForCheck();
    }
  }
  async saveGlobal(): Promise<void> {
    this.saving = 'global';
    this.error = '';
    this.message = '';
    try {
      this.globalExtraTimeMinutes = await saveGlobalExtraTime(Number(this.globalExtraTimeMinutes));
      this.message =
        'Splošni dodatni čas je shranjen in velja za planer ter tekoče/prihajajoče relacije.';
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Splošnega časa ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.changeDetector.markForCheck();
    }
  }
  async saveShipment(row: Shipment): Promise<void> {
    this.saving = String(row.id);
    this.error = '';
    this.message = '';
    try {
      this.shipmentEdits[row.id] = await saveShipmentExtraTime(
        row.id,
        Number(this.shipmentEdits[row.id]),
      );
      this.message = `Dodaten čas za ${row.code} je shranjen.`;
      this.shipments = await getShipments();
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Dodatnega časa ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.changeDetector.markForCheck();
    }
  }
  async ngOnInit(): Promise<void> {
    const results = await Promise.allSettled([
      getRoutes(),
      getShipments(),
      listAllDeliveryPlans(),
      getGlobalExtraTime(),
    ]);
    if (results[0].status === 'fulfilled') this.rows = results[0].value;
    if (results[1].status === 'fulfilled') {
      this.shipments = results[1].value;
      for (const row of this.shipments) {
        this.shipmentEdits[row.id] = row.extraTimeMinutes;
        this.shipmentModes[row.id] = /samo cesta|tovornjak/i.test(row.unitType) ? 'ROAD' : 'AUTO';
      }
    }
    if (results[2].status === 'fulfilled') this.plans = results[2].value;
    if (results[3].status === 'fulfilled') this.globalExtraTimeMinutes = results[3].value;
    const failures: string[] = [];
    if (results[0].status === 'rejected') failures.push('relacij');
    if (results[1].status === 'rejected') {
      failures.push('uvoženih pošiljk');
      this.shipmentsUnavailable = true;
    }
    if (results[2].status === 'rejected') {
      failures.push('načrtovanih relacij planerja');
      this.plansUnavailable = true;
    }
    if (results[3].status === 'rejected') failures.push('splošnega dodatnega časa');
    if (failures.length)
      this.error = `Podatkov (${failures.join(', ')}) ni mogoče naložiti. Preveri, ali API in MySQL delujeta, nato osveži stran.`;
    this.loading = false;
    this.changeDetector.markForCheck();
  }
}
function modeLabel(mode: 'AUTO' | 'ROAD' | 'INTERMODAL' | 'RO_LA'): string {
  return { AUTO: 'samodejni', ROAD: 'cestni', INTERMODAL: 'železniški', RO_LA: 'Ro-La' }[mode];
}
function asRecord(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function normalizePlace(
  value: PlaceSelection | string | null | undefined,
  fallbackLabel: string,
): PlaceSelection {
  if (typeof value === 'string')
    return { label: value || fallbackLabel, lat: null, lon: null, countryCode: null };
  return {
    label: value?.label || fallbackLabel || 'Lokacija',
    lat: value?.lat == null ? null : Number(value.lat),
    lon: value?.lon == null ? null : Number(value.lon),
    countryCode: value?.countryCode || null,
    state: value?.state || null,
  };
}
function localDateTimeInput(value: string | Date | null | undefined): string {
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return text;
  const mysql = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (mysql) return `${mysql[1]}T${mysql[2]}`;
  // MySQL DATETIME strings are timezone-less wall clock values. Parsing them
  // through Date shifts them to UTC and can produce empty/incorrect inputs.
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}T${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`;
}
