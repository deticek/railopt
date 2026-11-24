import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { createData, getDataCounts, getRoutes } from '../../core/api/transport-api';
import { Route } from '../../models';
type EntryKind = 'shipment' | 'route' | 'parameter' | 'holiday';
@Component({
  selector: 'app-data-entry',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './data-entry.html',
})
export class DataEntryComponent implements OnInit {
  routes: Route[] = [];
  parameterCount = 0;
  holidayCount = 0;
  message = '';
  error = '';
  saving: EntryKind | '' = '';
  shipment = {
    routeId: '' as string | number,
    loadingDate: '',
    deliveryDate: '',
    recipientDeadline: '',
    weightKg: 24000,
    unitType: 'P400',
    adr: false,
  };
  route = {
    code: '',
    direction: 'Izvoz',
    loadingCountry: 'SI',
    loadingPostalCode: '',
    loadingCity: '',
    unloadingCountry: 'AT',
    unloadingPostalCode: '',
    unloadingCity: '',
    roadDistanceKm: 1,
    unitType: 'P400',
    averageTrucksPerWeek: '',
    shipmentsCount: '',
    loadingWindowStart: '07:00',
    loadingWindowEnd: '11:00',
    unloadingWindowStart: '06:00',
    unloadingWindowEnd: '14:00',
    cargoGroup: '',
    note: '',
  };
  parameter = { group: '', name: '', value: '', unit: '', note: '' };
  holiday = { countryCode: 'SI', date: '', name: '', note: '' };
  async ngOnInit(): Promise<void> {
    await this.refresh();
  }
  async refresh(): Promise<void> {
    try {
      const [routes, counts] = await Promise.all([getRoutes(), getDataCounts()]);
      this.routes = routes;
      this.parameterCount = counts.parameters;
      this.holidayCount = counts.holidays;
      if (!this.shipment.routeId && routes.length) this.shipment.routeId = routes[0].id;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Podatkov ni mogoče naložiti.';
    }
  }
  async save(kind: EntryKind): Promise<void> {
    this.saving = kind;
    this.error = '';
    this.message = '';
    const endpoints = {
      shipment: '/shipments',
      route: '/routes',
      parameter: '/parameters',
      holiday: '/holidays',
    } as const;
    const bodies = {
      shipment: this.shipment,
      route: this.route,
      parameter: this.parameter,
      holiday: this.holiday,
    };
    try {
      await createData(endpoints[kind], bodies[kind]);
      this.message = 'Podatek je shranjen.';
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Podatka ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
    }
  }
}
