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
