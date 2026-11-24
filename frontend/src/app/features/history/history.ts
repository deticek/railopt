import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { compareShipment, getShipments } from '../../core/api/transport-api';
import {
  listAllDeliveryPlans,
  type DeliveryOption,
  type SavedDeliveryPlan,
} from '../../core/api/delivery-plans-api';
import { isCompletedDeliveryPlan } from '../../core/api/delivery-plan-status';
import type { Shipment } from '../../models';
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
