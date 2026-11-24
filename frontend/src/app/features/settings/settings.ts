import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { createUser, listUsers } from '../../core/api/auth-api';
@Component({ selector: 'app-settings', standalone: true, imports: [FormsModule], templateUrl: './settings.html' })
export class SettingsComponent implements OnInit {
  role = Number(sessionStorage.getItem('railopt-role') || 0); username = sessionStorage.getItem('railopt-user') || ''; users: Array<{ id: string; username: string; email: string; role: number; active: boolean }> = [];
  name = ''; email = ''; password = ''; newRole = 2; error = ''; message = '';
  async ngOnInit(): Promise<void> { if (this.role === 1) await this.loadUsers(); }
  async loadUsers(): Promise<void> { try { this.users = await listUsers(); } catch (e) { this.error = e instanceof Error ? e.message : 'Uporabnikov ni mogoče naložiti.'; } }
  async saveUser(): Promise<void> { this.error = ''; this.message = ''; try { await createUser({ username: this.name, email: this.email, password: this.password, role: this.newRole }); this.message = 'Uporabnik je dodan.'; this.name=''; this.email=''; this.password=''; await this.loadUsers(); } catch (e) { this.error = e instanceof Error ? e.message : 'Uporabnika ni mogoče dodati.'; } }
}
