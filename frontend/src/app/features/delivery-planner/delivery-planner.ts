import { ChangeDetectorRef, Component, OnDestroy, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlacePickerComponent } from '../../components/place-picker/place-picker';
import { RouteMapComponent } from '../../components/route-map';
import {
  calculateLatestLoading,
  estimateDeliveryPlan,
  listDeliveryPlans,
  saveDeliveryPlan,
  type DeliveryOption,
  type DeliveryPlanInput,
  type DeliveryPlanResult,
  type PlaceSelection,
  type SavedDeliveryPlan,
} from '../../core/api/delivery-plans-api';
import { getGlobalExtraTime } from '../../core/api/transport-api';

function localInputDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
@Component({
  selector: 'app-delivery-planner',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DatePipe, PlacePickerComponent, RouteMapComponent],
  templateUrl: './delivery-planner.html',
  styleUrl: './delivery-planner.scss',
})
export class DeliveryPlannerComponent implements OnInit, OnDestroy {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}
  origin: PlaceSelection | null = null;
  destination: PlaceSelection | null = null;
  loadingAt = localInputDate(new Date());
  deliveryDeadlineAt = localInputDate(new Date(Date.now() + 72 * 3600000));
  scheduleMode: 'arrival' | 'latest-loading' = 'arrival';
  extraTimeHours = 0;
  extraTimeRemainderMinutes = 0;
  weightKg = 24000;
  unitType = 'P400 – dvigljiva prikolica';
  equipmentCatalog: Array<{id:string;name:string;category:string;uct:'da'|'zamenjava'|'ne';length_m:number;width_m:number;height_m:number;tare_t:number;tractor_t:number;payload_t:number;pallets:number;volume_m3:number;adr:boolean;temp:boolean;note:string;source:string}> = [];
  equipmentCatalogId = '';
  showFullTrailerCatalog=localStorage.getItem('railopt-all-trailers')==='true';
  globalExtraTimeMinutes = 0;
  readonly transportMode = 'compare' as const;
  selectedTransportMode: 'AUTO'|'ROAD'|'INTERMODAL'|'RO_LA' = 'AUTO';
  preference: 'cost' | 'emissions' | 'time' = 'cost';
  roLaTicketEur = 0;
  adr = false;
  weekendBan = true;
  costMode: 'excel' | 'detailed' = 'excel';
  loadingWindowStart = '07:00';
  loadingWindowEnd = '11:00';
  unloadingWindowStart = '07:00';
  unloadingWindowEnd = '15:00';
  fuelPricePerLitre = 1.55;
  fuelConsumptionLPer100Km = 30;
  driverCostPerHour = 18;
  tollsEur = 0;
  customsEur = 0;
  otherVehicleEur = 0;
  readonly result = signal<DeliveryPlanResult | null>(null);
  readonly selectedOptionId = signal('road');
  readonly estimateId = signal('');
  readonly busy = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly progress = signal('');
  readonly elapsed = signal(0);
  readonly saved = signal<SavedDeliveryPlan[]>([]);
  readonly saveMessage = signal('');
  private timer?: ReturnType<typeof setInterval>;
  ngOnInit(): void {
    void this.refreshSaved();
    if(this.showFullTrailerCatalog)void fetch(new URL('assets/trailer-catalog.json',document.baseURI)).then(r=>r.ok?r.json():[]).then(rows=>{this.equipmentCatalog=rows;this.changeDetector.markForCheck();}).catch(()=>{});
    void getGlobalExtraTime()
      .then((value) => {
        this.globalExtraTimeMinutes = value;
        this.changeDetector.markForCheck();
      })
      .catch(() => {});
  }
  setOrigin(place: PlaceSelection | null): void {
    this.origin = place;
  }
  setDestination(place: PlaceSelection | null): void {
    this.destination = place;
  }
  setUnitType(unitType: string): void {
    this.unitType = unitType;
    this.equipmentCatalogId = '';
    this.keepTransportModeCompatible();
  }
  setCatalogEquipment(id:string):void{this.equipmentCatalogId=id;const item=this.equipmentCatalog.find(x=>x.id===id);if(!item)return;if(item.id==='P400')this.unitType='P400 – dvigljiva prikolica';else if(item.id==='ZABOJ1360')this.unitType='Izmenljivi zaboj';else if(item.id==='Z40HC')this.unitType='Kontejner 40 HC';else if(item.id==='Z45PW')this.unitType='Zabojnik 45′';else if(item.uct==='ne')this.unitType='Nedvigljiva prikolica s ponjavo';else this.unitType='P400 – dvigljiva prikolica';this.keepTransportModeCompatible();}
  private keepTransportModeCompatible():void{if(this.selectedTransportMode==='INTERMODAL'&&!this.usesIntermodal)this.selectedTransportMode=this.usesRoLa?'RO_LA':'ROAD';else if(this.selectedTransportMode==='RO_LA'&&!this.usesRoLa)this.selectedTransportMode=this.usesIntermodal?'INTERMODAL':'ROAD';}
  get selectedCatalogItem(){return this.equipmentCatalog.find(x=>x.id===this.equipmentCatalogId)||null;}
  get maxWeightKg(): number {
    if(this.selectedCatalogItem)return Math.floor(this.selectedCatalogItem.payload_t*1000);
    const unit = this.unitType.toLocaleLowerCase('sl-SI');
    if (unit.includes('zabojnik 45') || /zaboj\s*45/.test(unit)) return 22000;
    if (unit.includes('izmenljivi zaboj')) return 23000;
    return 24000;
  }
  get extraTimeMinutes(): number {
    return Number(this.extraTimeHours || 0) * 60 + Number(this.extraTimeRemainderMinutes || 0);
  }
  setScheduleMode(mode: 'arrival' | 'latest-loading'): void {
    this.scheduleMode = mode;
    this.result.set(null);
    this.estimateId.set('');
    this.error.set('');
  }
  async calculate(): Promise<void> {
    if (this.busy()) return;
    const extra = this.extraTimeMinutes;
    if (!Number.isInteger(extra) || extra + this.globalExtraTimeMinutes > 720) {
      this.error.set('Skupni dodatni čas ne sme presegati 12 ur.');
      return;
    }
    if (!this.origin || !this.destination) {
      this.error.set('Na zemljevidu izberi kraj naklada in kraj razklada.');
      return;
    }
    const weight = Number(this.weightKg);
    if (weight > this.maxWeightKg) {
      this.error.set(
        (this.unitType.toLocaleLowerCase('sl-SI').includes('zabojnik 45') || /zaboj\s*45/.test(this.unitType.toLocaleLowerCase('sl-SI')))
          ? 'Za zabojnik 45′ je največja teža tovora 22.000 kg.'
          : this.unitType.toLocaleLowerCase('sl-SI').includes('izmenljivi zaboj')
            ? 'Za izmenljivi zaboj je največja teža tovora 23.000 kg.'
            : 'Največja dovoljena teža tovora je 24.000 kg.',
      );
      return;
    }
    let loadingAt = this.loadingAt;
    let deadline = this.deliveryDeadlineAt;
    if (this.scheduleMode === 'arrival') {
      const future = new Date(loadingAt);
      future.setDate(future.getDate() + 60);
      deadline = localInputDate(future);
    } else {
      const requestedDeadline = new Date(this.deliveryDeadlineAt);
      const now = new Date();
      const earliestSearch = new Date(requestedDeadline.getTime() - 90 * 24 * 60 * 60 * 1000);
      if (Number.isFinite(earliestSearch.getTime()) && now < earliestSearch) now.setTime(earliestSearch.getTime());
      loadingAt = localInputDate(now);
    }
    this.error.set('');
    this.saveMessage.set('');
    this.result.set(null);
    this.busy.set(true);
    this.elapsed.set(0);
    this.progress.set(
      this.scheduleMode === 'arrival'
        ? 'Izračunavam prihod od izbranega naklada…'
        : 'Iščem najkasnejši možni naklad…',
    );
    this.timer = setInterval(() => this.elapsed.update((v) => v + 1), 1000);
    const input: DeliveryPlanInput = {
      origin: this.origin,
      destination: this.destination,
      loadingAt,
      deliveryDeadlineAt: deadline,
      loadingWindowStart: this.loadingWindowStart,
      loadingWindowEnd: this.loadingWindowEnd,
      unloadingWindowStart: this.unloadingWindowStart,
      unloadingWindowEnd: this.unloadingWindowEnd,
      weightKg: Number(this.weightKg),
      unitType: this.unitType,
      ...(this.selectedCatalogItem?{equipmentCatalogId:this.selectedCatalogItem.id,equipmentName:this.selectedCatalogItem.name}:{}),
      extraTimeMinutes: extra + this.globalExtraTimeMinutes,
      globalExtraTimeMinutes: this.globalExtraTimeMinutes,
      transportMode: this.selectedTransportMode === 'ROAD' ? 'road' : this.transportMode,
      selectedTransportMode: this.selectedTransportMode,
      preference: this.preference,
      roLaTicketEur: Number(this.roLaTicketEur),
      adr: this.adr,
      weekendBan: this.weekendBan,
      costMode: this.costMode,
      costs: {
        fuelPricePerLitre: Number(this.fuelPricePerLitre),
        fuelConsumptionLPer100Km: Number(this.fuelConsumptionLPer100Km),
        driverCostPerHour: Number(this.driverCostPerHour),
        tollsEur: Number(this.tollsEur),
        customsEur: Number(this.customsEur),
        otherVehicleEur: Number(this.otherVehicleEur),
      },
    };
    try {
      this.progress.set('Iskanje cestnih odsekov in praznikov…');
      if (this.scheduleMode === 'latest-loading') {
        const response = await calculateLatestLoading(input);
        this.result.set(response.result);
        this.selectedOptionId.set(
          response.result.recommendedOptionId || response.result.options[0]?.id || 'road',
        );
        this.estimateId.set(response.estimateId);
        this.progress.set('Najkasnejši naklad je izračunan.');
      } else {
        const response = await estimateDeliveryPlan(input);
        this.result.set(response.result);
        this.selectedOptionId.set(
          response.result.recommendedOptionId || response.result.options[0]?.id || 'road',
        );
        this.estimateId.set(response.estimateId);
        this.progress.set('Prihod je izračunan.');
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Izračun dostave ni uspel.');
    } finally {
      this.busy.set(false);
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      this.changeDetector.markForCheck();
    }
  }
  async save(): Promise<void> {
    if (!this.estimateId() || this.saving()) return;
    this.saving.set(true);
    this.saveMessage.set('');
    try {
      const response = await saveDeliveryPlan(this.estimateId(), this.selectedOptionId());
      this.saveMessage.set(
        response.storage === 'parameters'
          ? 'Primerjava je shranjena v bazo.'
          : 'Primerjava je shranjena.',
      );
      this.estimateId.set('');
      await this.refreshSaved();
    } catch (e) {
      this.saveMessage.set(e instanceof Error ? e.message : 'Shranjevanje ni uspelo.');
    } finally {
      this.saving.set(false);
    }
  }
  async refreshSaved(): Promise<void> {
    try {
      this.saved.set(await listDeliveryPlans());
    } catch {
      /* Keep the planner usable if history is unavailable. */
    }
  }
  currentOption(): DeliveryOption | null {
    return (
      this.result()?.options.find((option) => option.id === this.selectedOptionId()) ||
      this.result()?.options[0] ||
      null
    );
  }
  selectOption(id: string): void {
    this.selectedOptionId.set(id);
  }
  get usesRoLa(): boolean {
    if(this.selectedCatalogItem){const item=this.selectedCatalogItem,gross=item.tare_t+item.tractor_t+Number(this.weightKg)/1000;return item.length_m<=18.8&&item.width_m<=2.6&&item.height_m<=4&&gross<=(item.category==='zabojnik'?44:40)&&(!this.adr||item.adr);}
    return /nedvigljiv|ponjav|tovornjak/i.test(this.unitType);
  }
  get usesIntermodal(): boolean {
    if(this.selectedCatalogItem)return this.selectedCatalogItem.uct!=='ne'&&(!this.adr||this.selectedCatalogItem.adr);
    return /p400|izmenljivi zaboj|zabojnik 45|zaboj\s*45/i.test(this.unitType);
  }
  fmt(date: string): string {
    return new Date(date).toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short' });
  }
  duration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60),
      mins = minutes % 60;
    return mins ? `${hours} h ${mins} min` : `${hours} h`;
  }
  trackEvent(index: number): number {
    return index;
  }
  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
