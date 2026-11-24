import { apiRequest, readApiError } from './api-client';
import { formatDate, formatMoney, type Route, type Shipment } from '../../models';
import type { DeliveryPlanInput, DeliveryPlanResult } from './delivery-plans-api';

export interface DashboardData {
  shipmentCount: number;
  monthShipments: number;
  routeCount: number;
  optimizedCount: number;
  recommendedCo2Kg: number;
  recentShipments: Array<{ shipmentNumber: number; route: string; status: string; transportType: string; deliveryDate: string; cost: number | null; co2Kg: number | null }>;
}

export async function getDashboard(): Promise<DashboardData> {
  const response = await apiRequest('/dashboard');
  if (!response.ok) throw new Error(await readApiError(response, 'Pregled ni na voljo.'));
  return response.json();
}

export async function getRoutes(): Promise<Route[]> {
  const response = await apiRequest('/routes');
  if (!response.ok) throw new Error(await readApiError(response, 'Relacij ni mogoče prebrati.'));
  return response.json();
}

export async function getShipments(): Promise<Shipment[]> {
  const response = await apiRequest('/shipments?limit=500');
  if (!response.ok) throw new Error(await readApiError(response, 'Pošiljk ni mogoče prebrati.'));
  const rows = await response.json() as Array<{ id: string | number; routeId: string | number; shipmentNumber: number; route: string; status: string; transportType: string; loadingDate: string; deliveryDate: string; recipientDeadline: string; weightKg: number | null; unitType: string; adr: boolean; extraTimeMinutes: number; routeExtraTimeMinutes: number; calculatedDeliveryAt: string | null; cost: number | null; co2Kg: number | null }>;
  return rows.map(item => ({ id:item.id, routeId:item.routeId, code: `#${item.shipmentNumber}`, route: item.route?.trim() || '—', status: item.status,
    mode: ({ ROAD: 'Cestni', INTERMODAL: 'Intermodalni', RO_LA: 'RO-LA' } as Record<string, string>)[item.transportType] || item.transportType,
    date: formatDate(item.deliveryDate), deliveryDateRaw:String(item.deliveryDate).slice(0,10), loadingDate:String(item.loadingDate).slice(0,10), recipientDeadline:item.recipientDeadline ? String(item.recipientDeadline).slice(0,10) : String(item.deliveryDate).slice(0,10), weightKg:item.weightKg == null ? null : Number(item.weightKg), unitType:item.unitType, adr:item.adr, extraTimeMinutes:item.extraTimeMinutes, routeExtraTimeMinutes:item.routeExtraTimeMinutes, calculatedDeliveryAt:item.calculatedDeliveryAt, cost: formatMoney(item.cost), co2: item.co2Kg == null ? '—' : `${new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 0 }).format(item.co2Kg)} kg` }));
}

export async function calculateShipment(id:string|number,transportMode:'AUTO'|'ROAD'|'INTERMODAL'|'RO_LA'):Promise<{mode:string;cost:number|null;co2Kg:number;deliveryAt:string;feasible:boolean}>{const response=await apiRequest(`/shipments/${encodeURIComponent(String(id))}/calculate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({transportMode}),signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(await readApiError(response,'Izračun pošiljke ni uspel.'));return response.json();}
export interface ShipmentComparisonOption {id:'road'|'rail'|'rola';title:string;mode:string;costEur:number|null;emissionsKgCo2e:number;deliveryAt:string;totalElapsedHours:number;roadKm:number;railKm:number;feasible:boolean;warnings:string[]}
export interface ShipmentComparisonPreview { options:ShipmentComparisonOption[]; recommendedOptionId:string|null; input?:DeliveryPlanInput; result?:DeliveryPlanResult }
export async function compareShipment(id:string|number):Promise<ShipmentComparisonPreview>{const response=await apiRequest(`/shipments/${encodeURIComponent(String(id))}/compare`,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(await readApiError(response,'Primerjave prevozov ni bilo mogoče izračunati.'));return response.json();}
export async function startShipmentCalculations():Promise<{taskId:string;total:number}>{const response=await apiRequest('/shipments/calculate-all',{method:'POST'});if(!response.ok)throw new Error(await readApiError(response,'Izračuna pošiljk ni bilo mogoče zagnati.'));return response.json();}
export async function getShipmentCalculationProgress(taskId:string):Promise<{status:'running'|'complete'|'failed';total:number;completed:number;failed:number;errors:Array<{shipmentId:string|number;message:string}>;fatalError?:string}>{const response=await apiRequest(`/shipments/calculations/${encodeURIComponent(taskId)}`);if(!response.ok)throw new Error(await readApiError(response,'Stanja izračuna ni mogoče prebrati.'));return response.json();}

export async function updateShipment(shipment: Shipment): Promise<void> {
  const response = await apiRequest(`/shipments/${encodeURIComponent(String(shipment.id))}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ routeId:shipment.routeId, shipmentNumber:Number(shipment.code.replace(/^#/,'')), loadingDate:shipment.loadingDate, deliveryDate:shipment.deliveryDateRaw, recipientDeadline:shipment.recipientDeadline, weightKg:Number(shipment.weightKg), unitType:shipment.unitType, adr:shipment.adr }) });
  if(!response.ok) throw new Error(await readApiError(response,'Podatkov pošiljke ni bilo mogoče shraniti.'));
}

export async function updateRoute(route: Route): Promise<void> {
  const response = await apiRequest(`/routes/${encodeURIComponent(String(route.id))}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(route) });
  if(!response.ok)throw new Error(await readApiError(response,'Relacije ni bilo mogoče shraniti.'));
}
export async function saveGlobalExtraTime(extraTimeMinutes:number):Promise<number> {
  const response=await apiRequest('/route-settings/global-extra-time',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({extraTimeMinutes})});
  if(!response.ok)throw new Error(await readApiError(response,'Splošnega dodatnega časa ni bilo mogoče shraniti.'));
  return (await response.json() as {extraTimeMinutes:number}).extraTimeMinutes;
}
export async function saveShipmentExtraTime(id:string|number,extraTimeMinutes:number):Promise<number> {
  const response=await apiRequest(`/shipments/${encodeURIComponent(String(id))}/extra-time`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({extraTimeMinutes})});
  if(!response.ok)throw new Error(await readApiError(response,'Dodatnega časa za pošiljko ni bilo mogoče shraniti.'));
  return (await response.json() as {extraTimeMinutes:number}).extraTimeMinutes;
}
export async function getGlobalExtraTime():Promise<number> {
  const response=await apiRequest('/route-settings');
  if(!response.ok)throw new Error(await readApiError(response,'Splošnega dodatnega časa ni mogoče prebrati.'));
  return (await response.json() as {extraTimeMinutes:number}).extraTimeMinutes;
}

export async function getDataCounts(): Promise<{ parameters: number; holidays: number }> {
  const [parameters, holidays] = await Promise.all([apiRequest('/parameters'), apiRequest('/holidays')]);
  if (!parameters.ok || !holidays.ok) throw new Error('Podatkov ni mogoče prebrati.');
  return { parameters: (await parameters.json() as unknown[]).length, holidays: (await holidays.json() as unknown[]).length };
}

export async function createData(path: '/shipments' | '/routes' | '/parameters' | '/holidays', body: unknown): Promise<void> {
  const response = await apiRequest(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await readApiError(response, 'Podatkov ni bilo mogoče shraniti.'));
}
