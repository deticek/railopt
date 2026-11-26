import { Component } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { NavbarComponent, DashboardView } from '../components/navbar/navbar';
import { logout } from '../core/api/auth-api';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent],
  templateUrl: './dashboard-shell.html',
})
export class DashboardShellComponent {
  username = sessionStorage.getItem('railopt-user') || 'Uporabnik';
  activeView: DashboardView = 'overview';
  readonly titles: Record<DashboardView, string> = {
    overview: 'Pregled poslovanja',
    history: 'Zgodovina',
    holidays: 'Prazniki in prosti dnevi',
    disruptions: 'Cestne in železniške motnje',
    business: 'Poslovni potek',
    equipment: 'Oprema',
    terminals: 'Zemljevid terminalov',
    parameters: 'Parametri',
    routes: 'Transportne relacije',
    emissions: 'Planer dostave',
    settings: 'Nastavitve',
  };
  constructor(private readonly router: Router) {
    this.syncRoute();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.syncRoute();
    });
  }
  get pageTitle(): string {
    return this.titles[this.activeView];
  }
  private syncRoute(): void {
    const path = this.router.url.split('?')[0].split('/')[1] || 'overview';
    this.activeView = (path in this.titles ? path : 'overview') as DashboardView;
  }
  navigate(view: DashboardView): void {
    void this.router.navigateByUrl('/' + (view === 'overview' ? 'overview' : view));
  }
  async signOut(): Promise<void> {
    await logout();
    sessionStorage.clear();
    void this.router.navigateByUrl('/login');
  }
}
