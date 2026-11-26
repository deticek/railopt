import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { DashboardShellComponent } from './layout/dashboard-shell';
import { LoginComponent } from './features/login/login';
import { OverviewComponent } from './features/overview/overview';
import { HistoryComponent } from './features/history/history';
import { RoutesComponent } from './features/routes/routes';
import { DataEntryComponent } from './features/data-entry/data-entry';
import { DeliveryPlannerComponent } from './features/delivery-planner/delivery-planner';
import { SettingsComponent } from './features/settings/settings';
import { HolidaysComponent } from './features/holidays';
import { DisruptionsComponent } from './features/disruptions';
import { BusinessComponent } from './features/business/business';
import { EquipmentComponent } from './features/equipment/equipment';
import { ParametersComponent } from './features/parameters/parameters';
import { TerminalMapComponent } from './features/terminals/terminals';

const sessionGuard: CanActivateFn = (_route, state) =>
  sessionStorage.getItem('railopt-token')
    ? true
    : inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  {
    path: '',
    component: DashboardShellComponent,
    canActivate: [sessionGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      { path: 'overview', component: OverviewComponent },
      { path: 'history', component: HistoryComponent },
      { path: 'business', component: BusinessComponent },
      { path: 'equipment', component: EquipmentComponent },
      { path: 'terminals', component: TerminalMapComponent },
      { path: 'parameters', component: ParametersComponent },
      { path: 'holidays', component: HolidaysComponent },
      { path: 'disruptions', component: DisruptionsComponent },
      { path: 'shipments', redirectTo: 'history' },
      { path: 'routes', component: RoutesComponent },
      { path: 'data', component: DataEntryComponent },
      { path: 'emissions', component: DeliveryPlannerComponent },
      { path: 'optimization', redirectTo: 'routes' },
      { path: 'settings', component: SettingsComponent },
    ],
  },
  { path: '**', redirectTo: '' },
];
