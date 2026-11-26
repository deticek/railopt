import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { compareShipment, getShipments, getShipmentCalculationProgress, startShipmentCalculations } from '../../core/api/transport-api';
import {
  listAllDeliveryPlans,
  updateSavedDeliveryPlan,
  type DeliveryOption,
  type SavedDeliveryPlan,
} from '../../core/api/delivery-plans-api';
import { isCompletedDeliveryPlan } from '../../core/api/delivery-plan-status';
import { getRoutes } from '../../core/api/transport-api';
import { listBusinessShipments, listTrailers, listUnitTerminals } from '../../core/api/admin-api';
import { listRailDisruptions, listRailTerminals, listRoadDisruptions } from '../../core/api/delivery-plans-api';
import { apiRequest } from '../../core/api/api-client';
import { importExcelWorkbook } from '../../core/api/excel-import-api';
import type { Shipment } from '../../models';
import { exportJsonArchive, exportRecordsCsv, exportRecordsPdf, makePlanExportRecord, makeShipmentExportRecord, type ExportRecord } from '../../core/export-data';
import {
  DeliveryPlanDetailsComponent,
  fastestDeliveryOption,
} from '../../components/delivery-plan-details/delivery-plan-details';

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [DatePipe, DeliveryPlanDetailsComponent],
  templateUrl: './history.html',
})
export class HistoryComponent implements OnInit {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}
  rows: Shipment[] = [];
  plans: SavedDeliveryPlan[] = [];
  loading = true;
  error = '';
  expandedPlanId = '';
  shipmentError = '';
  planError = '';
  expandedShipmentId = '';
  shipmentDetailLoadingId = '';
  shipmentDetails: Record<string, SavedDeliveryPlan> = {};
  shipmentDetailErrors: Record<string, string> = {};
  recalculatingShipments = false;
  recalcProgress = { total: 0, completed: 0, failed: 0 };
  recalcMessage = '';
  recalculatingPlans = false;
  planRecalcProgress = { total: 0, completed: 0, failed: 0 };
  exportBusy = '';
  exportMessage = '';
  readonly isAdmin=Number(sessionStorage.getItem('railopt-role'))===1;
  excelFile:File|null=null;importingExcel=false;importMessage='';
  get historyShipments(): Shipment[] {
    return this.rows;
  }
  shipmentStatus(row: Shipment): string {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const completedBy = row.recipientDeadline || row.deliveryDateRaw;
    return completedBy && completedBy < todayKey ? 'Zaključena' : 'Načrtovana';
  }
  get historyPlans(): SavedDeliveryPlan[] {
    return this.plans;
  }
  planStatus(plan: SavedDeliveryPlan): string {
    return isCompletedDeliveryPlan(plan) ? 'Zaključena' : 'Načrtovana';
  }
  fastestOption(plan: SavedDeliveryPlan): DeliveryOption | null {
    return fastestDeliveryOption(plan.result.options || []);
  }
  private safeFilename(value: string): string { return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'izvoz'; }
  private writeExport(name: string, title: string, records: ExportRecord[], format: 'csv' | 'pdf'): void {
    if (format === 'csv') exportRecordsCsv(`${this.safeFilename(name)}.csv`, records);
    else exportRecordsPdf(title, records);
    this.exportMessage = format === 'csv' ? 'CSV datoteka je prenesena in jo lahko odpreš v Excelu.' : 'Odprlo se je tiskanje; izberi »Shrani kot PDF«.';
  }
  async exportOneShipment(row: Shipment, format: 'csv' | 'pdf'): Promise<void> {
    const id = String(row.id); this.exportBusy = id; this.exportMessage = '';
    try {
      const preview = await compareShipment(row.id);
      this.writeExport(`posiljka_${row.code}`, `Pošiljka ${row.code}`, [makeShipmentExportRecord(row, preview)], format);
    } catch (error) { this.exportMessage = error instanceof Error ? error.message : 'Pošiljke ni bilo mogoče izvoziti.'; }
    finally { this.exportBusy = ''; this.changeDetector.markForCheck(); }
  }
  exportOnePlan(plan: SavedDeliveryPlan, format: 'csv' | 'pdf'): void {
    try { this.writeExport(`relacija_${plan.id}`, `Relacija ${plan.origin} → ${plan.destination}`, [makePlanExportRecord(plan)], format); }
    catch (error) { this.exportMessage = error instanceof Error ? error.message : 'Relacije ni bilo mogoče izvoziti.'; }
  }
  async exportAllHistory(format: 'csv' | 'pdf', section: 'all' | 'shipments' | 'plans' = 'all'): Promise<void> {
    if (this.exportBusy) return;
    this.exportBusy = 'all'; this.exportMessage = '';
    const records: ExportRecord[] = [];
    const batchSize = 5;
    try {
      const shipments = section === 'plans' ? [] : this.historyShipments;
      for (let start = 0; start < shipments.length; start += batchSize) {
        const batch = shipments.slice(start, start + batchSize);
        const results = await Promise.allSettled(batch.map(row => compareShipment(row.id)));
        results.forEach((result, index) => records.push(result.status === 'fulfilled'
          ? makeShipmentExportRecord(batch[index], result.value)
          : makeShipmentExportRecord(batch[index], undefined, result.reason instanceof Error ? result.reason.message : 'Izračun ni na voljo')));
        this.exportMessage = `Pripravljam izvoz pošiljk ${Math.min(start + batch.length, shipments.length)}/${shipments.length}…`;
        this.changeDetector.markForCheck();
      }
      if (section !== 'shipments') records.push(...this.historyPlans.map(makePlanExportRecord));
      if (!records.length) throw new Error('Za izvoz ni zapisov.');
      this.writeExport('railopt_zgodovina', 'Celotna zgodovina pošiljk in relacij', records, format);
    } catch (error) { this.exportMessage = error instanceof Error ? error.message : 'Zgodovine ni bilo mogoče izvoziti.'; }
    finally { this.exportBusy = ''; this.changeDetector.markForCheck(); }
  }
  async exportCompleteArchive():Promise<void>{
    if(this.exportBusy)return;this.exportBusy='archive';this.exportMessage='Pripravljam celoten arhiv…';this.error='';this.changeDetector.markForCheck();
    try{
      const read=async(path:string)=>{const response=await apiRequest(path);if(!response.ok)throw new Error(`Arhivskega vira ${path} ni mogoče prebrati.`);return response.json();};
      const [routes,parameters,holidays,railTerminals,railDisruptions,roadDisruptions,trailers,unitTerminals,businessShipments]=await Promise.all([getRoutes(),read('/parameters'),read('/holidays'),listRailTerminals(),listRailDisruptions(),listRoadDisruptions(),listTrailers(),listUnitTerminals(),listBusinessShipments()]);
      const shipmentCalculations:unknown[]=[];const batchSize=5;
      for(let start=0;start<this.rows.length;start+=batchSize){const batch=this.rows.slice(start,start+batchSize);const settled=await Promise.allSettled(batch.map(row=>compareShipment(row.id)));settled.forEach((result,index)=>shipmentCalculations.push({shipmentId:batch[index].id,calculation:result.status==='fulfilled'?result.value:null,error:result.status==='rejected'?String(result.reason):null}));this.exportMessage=`Pripravljam izračune ${Math.min(start+batch.length,this.rows.length)}/${this.rows.length}…`;this.changeDetector.markForCheck();}
      const archive={format:'railopt-complete-archive-v1',exportedAt:new Date().toISOString(),shipments:this.rows,shipmentCalculations,deliveryPlans:this.plans,routes,parameters,holidays,railTerminals,railDisruptions,roadDisruptions,trailers,unitTerminals,businessShipments};
      exportJsonArchive(`railopt_celoten_arhiv_${new Date().toISOString().slice(0,10)}.json`,archive);this.exportMessage='Celoten JSON arhiv je prenesen.';
    }catch(e){this.error=e instanceof Error?e.message:'Celotnega arhiva ni bilo mogoče pripraviti.';}finally{this.exportBusy='';this.changeDetector.markForCheck();}
  }
  selectExcel(event:Event):void{this.excelFile=(event.target as HTMLInputElement).files?.[0]||null;this.importMessage='';}
  async importWorkbook():Promise<void>{if(!this.isAdmin||!this.excelFile||this.importingExcel)return;this.importingExcel=true;this.importMessage='Uvažam Excel in posodabljam ujemajoče se zapise…';this.error='';this.changeDetector.markForCheck();try{const result=await importExcelWorkbook(this.excelFile);const counts=result.imported;this.importMessage=`Uvoz končan: ${counts.routes} relacij, ${counts.shipments} pošiljk, ${counts.parameters} parametrov in ${counts.holidays} praznikov. Obstoječi zapisi z enako oznako relacije oziroma številko pošiljke so posodobljeni; drugih zapisov uvoz ne izbriše.`;this.excelFile=null;const refreshed=await Promise.allSettled([getShipments(),listAllDeliveryPlans()]);if(refreshed[0].status==='fulfilled')this.rows=refreshed[0].value;if(refreshed[1].status==='fulfilled')this.plans=refreshed[1].value;}catch(e){this.importMessage='';this.error=e instanceof Error?e.message:'Excelove datoteke ni bilo mogoče uvoziti.';}finally{this.importingExcel=false;this.changeDetector.markForCheck();}}
  isShipmentExpanded(row: Shipment): boolean {
    return this.expandedShipmentId === String(row.id);
  }
  isShipmentDetailLoading(row: Shipment): boolean {
    return this.shipmentDetailLoadingId === String(row.id);
  }
  shipmentDetail(row: Shipment): SavedDeliveryPlan | null {
    return this.shipmentDetails[String(row.id)] || null;
  }
  shipmentDetailError(row: Shipment): string {
    return this.shipmentDetailErrors[String(row.id)] || '';
  }
  async toggleShipmentDetails(row: Shipment): Promise<void> {
    const id = String(row.id);
    if (this.expandedShipmentId === id) {
      this.expandedShipmentId = '';
      delete this.shipmentDetails[id];
      return;
    }
    this.expandedShipmentId = id;
    this.shipmentDetailErrors[id] = '';
    if (this.shipmentDetails[id]) return;
    this.shipmentDetailLoadingId = id;
    this.changeDetector.markForCheck();
    try {
      const preview = await compareShipment(row.id);
      if (!preview.input?.origin || !preview.result) {
        throw new Error(
          'API ne vrača celotnega izračuna pošiljke. Znova zaženi backend, da se naloži posodobljena različica.',
        );
      }
      const result = preview.result;
      this.shipmentDetails[id] = {
        id: `shipment-${id}`,
        origin: preview.input.origin.label,
        destination: preview.input.destination.label,
        loadingAt: result.actualLoadingAt,
        deadlineAt: result.deadlineAt,
        weightKg: result.weightKg,
        unitType: result.unitType,
        costMode: result.cost.mode,
        createdAt: result.requestedLoadingAt,
        input: preview.input,
        result,
        storage: 'shipment',
      };
    } catch (error) {
      this.shipmentDetailErrors[id] =
        error instanceof Error ? error.message : 'Podrobnosti pošiljke ni bilo mogoče naložiti.';
    } finally {
      if (this.shipmentDetailLoadingId === id) this.shipmentDetailLoadingId = '';
      this.changeDetector.markForCheck();
    }
  }
  togglePlanDetails(id: string): void {
    this.expandedPlanId = this.expandedPlanId === id ? '' : id;
  }
  replacePlan(updated: SavedDeliveryPlan): void {
    this.plans = this.plans.map((plan) => (plan.id === updated.id ? updated : plan));
    this.changeDetector.markForCheck();
  }
  async recalculateAllShipments(): Promise<void> {
    if (this.recalculatingShipments) return;
    this.recalculatingShipments = true;
    this.error = '';
    this.recalcMessage = '';
    this.recalcProgress = { total: 0, completed: 0, failed: 0 };
    this.changeDetector.markForCheck();
    try {
      const task = await startShipmentCalculations();
      this.recalcProgress.total = task.total;
      let state = await getShipmentCalculationProgress(task.taskId);
      while (state.status === 'running') {
        this.recalcProgress = { total: state.total, completed: state.completed, failed: state.failed };
        this.changeDetector.markForCheck();
        await new Promise(resolve => setTimeout(resolve, 1000));
        state = await getShipmentCalculationProgress(task.taskId);
      }
      this.recalcProgress = { total: state.total, completed: state.completed, failed: state.failed };
      if (state.status === 'failed') throw new Error(state.fatalError || 'Ponovni izračun pošiljk ni uspel.');
      this.rows = await getShipments();
      this.shipmentDetails = {};
      this.expandedShipmentId = '';
      this.recalcMessage = `Posodobljeni izračuni: ${state.completed - state.failed} od ${state.total}.`;
      if (state.errors.length) this.error = `Nekaterih pošiljk ni bilo mogoče preračunati (${state.failed}); odpri podrobnosti posamezne pošiljke za razlog.`;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Ponovni izračun pošiljk ni uspel.';
    } finally {
      this.recalculatingShipments = false;
      this.changeDetector.markForCheck();
    }
  }
  async recalculateAllPlans(): Promise<void> {
    if (this.recalculatingPlans || !this.plans.length) return;
    this.recalculatingPlans = true;
    this.error = '';
    this.planRecalcProgress = { total: this.plans.length, completed: 0, failed: 0 };
    this.changeDetector.markForCheck();
    const updated = new Map<string, SavedDeliveryPlan>();
    for (const plan of this.plans) {
      try {
        const result = await updateSavedDeliveryPlan(plan.id, plan.input, plan.result?.selectedOptionId);
        updated.set(plan.id, result);
      } catch {
        this.planRecalcProgress.failed++;
      }
      this.planRecalcProgress.completed++;
      this.changeDetector.markForCheck();
    }
    this.plans = this.plans.map(plan => updated.get(plan.id) || plan);
    this.recalculatingPlans = false;
    this.recalcMessage = `Ponovno izračunane shranjene relacije: ${updated.size} od ${this.planRecalcProgress.total}.`;
    if (this.planRecalcProgress.failed)
      this.error = `${this.planRecalcProgress.failed} relacij ni bilo mogoče posodobiti; preveri pravice in manjkajoče stare podatke.`;
    this.changeDetector.markForCheck();
  }
  async ngOnInit(): Promise<void> {
    const results = await Promise.allSettled([getShipments(), listAllDeliveryPlans()]);
    if (results[0].status === 'fulfilled') this.rows = results[0].value;
    else this.shipmentError = 'Pošiljk iz baze ni bilo mogoče naložiti.';
    if (results[1].status === 'fulfilled') this.plans = results[1].value;
    else this.planError = 'Načrtovanih relacij ni bilo mogoče naložiti.';
    if (results.every((result) => result.status === 'rejected'))
      this.error = 'Zgodovine trenutno ni mogoče naložiti.';
    this.loading = false;
    this.changeDetector.markForCheck();
  }
}
