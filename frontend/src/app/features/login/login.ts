import { Component, isDevMode } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { login, loginAsDeveloper } from '../../core/api/auth-api';

declare global {
  interface Window { railoptEnvironment?: { isElectron: boolean; isDevelopment: boolean } }
}

@Component({ selector: 'app-login', standalone: true, imports: [FormsModule], templateUrl: './login.html' })
export class LoginComponent {
  readonly isDevelopment = isDevMode() || window.railoptEnvironment?.isDevelopment === true || new URLSearchParams(window.location.search).get('electronDev') === '1';
  email = ''; password = ''; loading = false; loginError = '';
  constructor(private readonly router: Router, private readonly route: ActivatedRoute) {}
  async signIn(): Promise<void> {
    if (!this.email.trim() || !this.password) { this.loginError = 'Vnesite e-poštni naslov in geslo.'; return; }
    this.loading = true; this.loginError = '';
    try { this.saveSession(await login(this.email.trim(), this.password)); this.password = ''; this.goToApp(); }
    catch (error) { this.loginError = error instanceof Error ? error.message : 'Prijava ni uspela.'; }
    finally { this.loading = false; }
  }
  async skipLogin(): Promise<void> {
    this.loading = true; this.loginError = '';
    try { this.saveSession(await loginAsDeveloper()); this.goToApp(); }
    catch (error) { this.loginError = error instanceof Error ? error.message : 'Razvojne prijave ni mogoče vzpostaviti.'; }
    finally { this.loading = false; }
  }
  private saveSession(session: { token: string; user: { name?: string; email?: string; role?: number } }): void {
    sessionStorage.setItem('railopt-token', session.token); sessionStorage.setItem('railopt-user', session.user.name || session.user.email || 'Uporabnik'); sessionStorage.setItem('railopt-role', String(session.user.role || 0));
  }
  private goToApp(): void { const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl'); void this.router.navigateByUrl(returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/overview'); }
}
