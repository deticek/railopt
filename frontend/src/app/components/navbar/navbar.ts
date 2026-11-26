import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export type DashboardView = 'overview' | 'history' | 'routes' | 'emissions' | 'holidays' | 'disruptions' | 'settings';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class NavbarComponent {
  @Input() activeView: DashboardView = 'overview';
  @Input() username = '';
  @Output() viewSelected = new EventEmitter<DashboardView>();
  @Output() signOut = new EventEmitter<void>();
  darkMode = localStorage.getItem('railopt-theme') === 'dark';
  toggleTheme(): void {
    this.darkMode = !this.darkMode;
    localStorage.setItem('railopt-theme', this.darkMode ? 'dark' : 'light');
    document.documentElement.dataset['theme'] = this.darkMode ? 'dark' : 'light';
  }
}
