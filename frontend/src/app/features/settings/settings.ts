import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { createUser, listUsers } from '../../core/api/auth-api';
import {
  AdminMessage,
  AuditEntry,
  Customer,
  RoleRecord,
  Trailer,
  UnitTerminal,
  UserRecord,
  deleteUser as deleteUserRequest,
  getCustomerShipments,
  listAdminMessages,
  listAuditLogs,
  listCustomers,
  listRoles,
  listTrailers,
  listUnitTerminals,
  replyAdminMessage,
  saveCustomer,
  saveCustomerShipments,
  saveRole,
  saveTrailer,
  sendAdminMessage,
  updateUser,
} from '../../core/api/admin-api';
import { getShipments } from '../../core/api/transport-api';
import type { Shipment } from '../../models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class SettingsComponent implements OnInit {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}
  role = Number(sessionStorage.getItem('railopt-role') || 0);
  username = sessionStorage.getItem('railopt-user') || '';
  permissions = new Set(
    (sessionStorage.getItem('railopt-permissions') || '').split(',').filter(Boolean),
  );
  tab: 'account' | 'roles' | 'messages' | 'operations' | 'customers' | 'logs' = 'account';
  users: UserRecord[] = [];
  deletingUserId = '';
  roles: RoleRecord[] = [
    { roleId: 1, role_name: 'Skrbnik', permissions: ['*'], systemRole: true },
    {
      roleId: 2,
      role_name: 'Uporabnik',
      permissions: [
        'dashboard.read',
        'shipments.read',
        'routes.read',
        'planner.use',
        'messages.send',
      ],
      systemRole: true,
    },
  ];
  messages: AdminMessage[] = [];
  audit: AuditEntry[] = [];
  trailers: Trailer[] = [];
  terminals: UnitTerminal[] = [];
  customers: Customer[] = [];
  userRoleEdits: Record<string, number> = {};
  editingTrailer: Trailer | null = null;
  editingCustomer: Customer | null = null;
  shipments: Shipment[] = [];
  selectedCustomerId = '';
  selectedShipmentIds: Array<string | number> = [];
  readonly currentUserId = sessionStorage.getItem('railopt-user-id') || '';
  name = '';
  email = '';
  password = '';
  newRole = 2;
  roleName = '';
  editingRoleId: number | null = null;
  rolePermissions: string[] = [];
  subject = '';
  messageText = '';
  replyText: Record<string, string> = {};
  trailerName = '';
  trailerRegistration = '';
  trailerType = 'P400';
  trailerTerminalIds: string[] = [];
  trailerRolaTerminalIds: string[] = [];
  customerName = '';
  customerTax = '';
  customerEmail = '';
  customerPhone = '';
  customerAddress = '';
  terminalFilter = '';
  error = '';
  message = '';
  loading = false;
  allTrailerTypesEnabled = localStorage.getItem('railopt-all-trailers') === 'true';
  readonly permissionOptions = [
    { code: 'dashboard.read', label: 'Pregled in grafi' },
    { code: 'shipments.read', label: 'Branje pošiljk' },
    { code: 'shipments.write', label: 'Urejanje pošiljk' },
    { code: 'routes.read', label: 'Branje relacij' },
    { code: 'routes.write', label: 'Urejanje relacij' },
    { code: 'planner.use', label: 'Planer in izračuni' },
    { code: 'messages.send', label: 'Sporočilo administratorju' },
    { code: 'terminals.manage', label: 'Urejanje terminalov' },
    { code: 'trailers.manage', label: 'Urejanje prikolic' },
    { code: 'customers.read', label: 'Branje strank' },
    { code: 'customers.write', label: 'Urejanje strank' },
    { code: 'audit.read', label: 'Revizijski dnevniki' },
  ];
  get isAdmin(): boolean {
    return this.role === 1;
  }
  setAllTrailerTypes(enabled: boolean): void {
    this.allTrailerTypesEnabled = enabled;
    localStorage.setItem('railopt-all-trailers', enabled ? 'true' : 'false');
    this.message = enabled
      ? 'Celoten tehnični katalog je vklopljen v planerju.'
      : 'Planer uporablja osnovne vrste enot.';
  }
  get canManageOperations(): boolean {
    return (
      this.isAdmin ||
      this.permissions.has('terminals.manage') ||
      this.permissions.has('trailers.manage')
    );
  }
  get canSeeCustomers(): boolean {
    return (
      this.isAdmin ||
      this.permissions.has('customers.read') ||
      this.permissions.has('customers.write')
    );
  }
  get roleNameForUser(): string {
    return (
      this.roles.find((r) => r.roleId === this.role)?.role_name ||
      (this.role === 1 ? 'Skrbnik' : this.role === 2 ? 'Uporabnik' : `Vloga ${this.role}`)
    );
  }
  ngOnInit(): void {
    void this.load();
  }
  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    const jobs: Promise<unknown>[] = [];
    if (this.isAdmin) {
      jobs.push(
        listUsers().then((v) => {
          this.users = v;
          this.userRoleEdits = Object.fromEntries(v.map((u) => [u.id, u.role]));
        }),
        listRoles().then((v) => (this.roles = v)),
        listAdminMessages().then((v) => (this.messages = v)),
        listAuditLogs().then((v) => (this.audit = v)),
      );
    }
    if (this.canManageOperations) {
      jobs.push(
        listTrailers().then((v) => (this.trailers = v)),
        listUnitTerminals().then((v) => (this.terminals = v)),
      );
    }
    if (this.canSeeCustomers) {
      jobs.push(listCustomers().then((v) => (this.customers = v)));
      if (this.isAdmin || this.permissions.has('customers.write'))
        jobs.push(getShipments().then((v) => (this.shipments = v)));
    }
    const settled = await Promise.allSettled(jobs);
    const failed = settled.find((x) => x.status === 'rejected');
    if (failed?.status === 'rejected')
      this.error =
        failed.reason instanceof Error
          ? failed.reason.message
          : 'Nekaterih podatkov ni bilo mogoče naložiti.';
    this.loading = false;
    this.changeDetector.markForCheck();
  }
  roleLabel(id: number): string {
    return this.roles.find((r) => r.roleId === id)?.role_name || `Vloga ${id}`;
  }
  async saveUser(): Promise<void> {
    this.error = '';
    this.message = '';
    try {
      await createUser({
        username: this.name,
        email: this.email,
        password: this.password,
        role: this.newRole,
      });
      this.message = 'Račun je dodan.';
      this.name = '';
      this.email = '';
      this.password = '';
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Računa ni bilo mogoče dodati.';
    }
  }
  async toggleUser(user: UserRecord): Promise<void> {
    if (user.id === sessionStorage.getItem('railopt-user-id')) return;
    this.error = '';
    try {
      await updateUser({ ...user, active: !user.active });
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Računa ni bilo mogoče posodobiti.';
    }
  }
  async deleteUserAccount(user: UserRecord): Promise<void> {
    if (user.id === this.currentUserId || !window.confirm(`Ali res želiš izbrisati uporabniški račun »${user.username}«? Te akcije ni mogoče razveljaviti.`)) return;
    this.error = '';
    this.message = '';
    this.deletingUserId = user.id;
    try {
      await deleteUserRequest(user.id);
      this.message = `Račun ${user.username} je izbrisan.`;
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Uporabniškega računa ni bilo mogoče izbrisati.';
    } finally {
      this.deletingUserId = '';
      this.changeDetector.markForCheck();
    }
  }
  async saveUserRole(user: UserRecord): Promise<void> {
    try {
      await updateUser({ ...user, role: Number(this.userRoleEdits[user.id]), active: user.active });
      this.message = `Vloga za ${user.username} je shranjena.`;
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Vloge uporabnika ni bilo mogoče spremeniti.';
    }
  }
  startRole(role?: RoleRecord): void {
    this.editingRoleId = role?.roleId || null;
    this.roleName = role?.role_name || '';
    this.rolePermissions = role?.permissions?.includes('*') ? [] : [...(role?.permissions || [])];
    this.error = '';
  }
  togglePermission(code: string, checked: boolean): void {
    this.rolePermissions = checked
      ? [...new Set([...this.rolePermissions, code])]
      : this.rolePermissions.filter((x) => x !== code);
  }
  hasPermission(code: string): boolean {
    return this.rolePermissions.includes(code);
  }
  async saveRoleForm(): Promise<void> {
    this.error = '';
    try {
      await saveRole({
        roleId: this.editingRoleId || undefined,
        name: this.roleName,
        permissions: this.rolePermissions,
      });
      this.message = 'Vloga in dovoljenja so shranjeni.';
      this.startRole();
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Vloge ni bilo mogoče shraniti.';
    }
  }
  async sendMessage(): Promise<void> {
    this.error = '';
    this.message = '';
    try {
      await sendAdminMessage(this.subject, this.messageText);
      this.subject = '';
      this.messageText = '';
      this.message = 'Sporočilo je poslano administratorju.';
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Sporočila ni bilo mogoče poslati.';
    }
  }
  async reply(item: AdminMessage): Promise<void> {
    try {
      await replyAdminMessage(
        item.id,
        this.replyText[item.id] || '',
        (this.replyText[item.id] || '').trim() ? 'ANSWERED' : 'CLOSED',
      );
      this.messages = await listAdminMessages();
      this.message = 'Odgovor je shranjen.';
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Odgovora ni bilo mogoče shraniti.';
    }
  }
  async createTrailer(): Promise<void> {
    try {
      await saveTrailer({
        name: this.trailerName,
        registration: this.trailerRegistration || null,
        unitType: this.trailerType,
        note: '',
        active: true,
        terminalIds: this.trailerType === 'NON_LIFTABLE' ? [] : this.trailerTerminalIds,
        rolaTerminalIds: this.trailerType === 'NON_LIFTABLE' ? this.trailerRolaTerminalIds : [],
      });
      this.trailerName = '';
      this.trailerRegistration = '';
      this.trailerTerminalIds = [];
      this.trailerRolaTerminalIds = [];
      this.message = 'Prikolica je dodana.';
      this.trailers = await listTrailers();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Prikolice ni bilo mogoče shraniti.';
    }
  }
  editTrailer(item: Trailer): void {
    this.editingTrailer = {
      ...item,
      terminalIds: [...(item.terminalIds || [])],
      rolaTerminalIds: [...(item.rolaTerminalIds || [])],
    };
  }
  trailerEditTerminals(): UnitTerminal[] {
    const type = this.editingTrailer?.unitType || '';
    return this.terminals.filter((t) => t.unitType === (type === 'NON_LIFTABLE' ? 'RO_LA' : type));
  }
  trailerEditSelected(id: string): boolean {
    const item = this.editingTrailer;
    if (!item) return false;
    return (
      (item.unitType === 'NON_LIFTABLE' ? item.rolaTerminalIds : item.terminalIds)?.some(
        (x) => String(x) === String(id),
      ) || false
    );
  }
  toggleEditedTrailerTerminal(id: string, checked: boolean): void {
    const item = this.editingTrailer;
    if (!item) return;
    const field = item.unitType === 'NON_LIFTABLE' ? 'rolaTerminalIds' : 'terminalIds';
    const values = item[field] || [];
    item[field] = checked
      ? [...new Set([...values, id])]
      : values.filter((x) => String(x) !== String(id));
  }
  async saveEditedTrailer(): Promise<void> {
    if (!this.editingTrailer) return;
    try {
      await saveTrailer(this.editingTrailer);
      this.message = 'Podatki prikolice in terminali so shranjeni.';
      this.editingTrailer = null;
      this.trailers = await listTrailers();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Prikolice ni bilo mogoče posodobiti.';
    }
  }
  async createCustomer(): Promise<void> {
    try {
      await saveCustomer({
        name: this.customerName,
        taxNumber: this.customerTax,
        email: this.customerEmail,
        phone: this.customerPhone,
        address: this.customerAddress,
        active: true,
      });
      this.customerName = '';
      this.customerTax = '';
      this.customerEmail = '';
      this.customerPhone = '';
      this.customerAddress = '';
      this.message = 'Stranka je shranjena.';
      this.customers = await listCustomers();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Stranke ni bilo mogoče shraniti.';
    }
  }
  editCustomer(item: Customer): void {
    this.editingCustomer = { ...item };
  }
  async saveEditedCustomer(): Promise<void> {
    if (!this.editingCustomer) return;
    try {
      await saveCustomer(this.editingCustomer);
      this.message = 'Podatki stranke so shranjeni.';
      this.editingCustomer = null;
      this.customers = await listCustomers();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Stranke ni bilo mogoče posodobiti.';
    }
  }
  async openCustomerShipments(customer: Customer): Promise<void> {
    this.error = '';
    this.selectedCustomerId = this.selectedCustomerId === customer.id ? '' : customer.id;
    if (!this.selectedCustomerId) return;
    try {
      const linked = await getCustomerShipments(customer.id);
      this.selectedShipmentIds = linked.map((s) => s.id);
    } catch (e) {
      this.selectedShipmentIds = [];
      this.error = e instanceof Error ? e.message : 'Pošiljk stranke ni mogoče naložiti.';
    }
  }
  toggleCustomerShipment(id: string | number, checked: boolean): void {
    this.selectedShipmentIds = checked
      ? [...new Set([...this.selectedShipmentIds, id])]
      : this.selectedShipmentIds.filter((x) => String(x) !== String(id));
  }
  customerHasShipment(id: string | number): boolean {
    return this.selectedShipmentIds.some((x) => String(x) === String(id));
  }
  async saveCustomerLinks(): Promise<void> {
    if (!this.selectedCustomerId) return;
    try {
      await saveCustomerShipments(this.selectedCustomerId, this.selectedShipmentIds);
      this.message = 'Pošiljke so povezane s stranko.';
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Povezave pošiljk ni bilo mogoče shraniti.';
    }
  }
  get visibleTerminals(): UnitTerminal[] {
    return this.terminals.filter((x) => !this.terminalFilter || x.unitType === this.terminalFilter);
  }
  get compatibleTrailerTerminals(): UnitTerminal[] {
    return this.terminals.filter(
      (x) => x.unitType === (this.trailerType === 'NON_LIFTABLE' ? 'RO_LA' : this.trailerType),
    );
  }
  trailerTerminalSelected(id: string): boolean {
    return (
      this.trailerType === 'NON_LIFTABLE' ? this.trailerRolaTerminalIds : this.trailerTerminalIds
    ).some((x) => String(x) === String(id));
  }
  toggleTrailerTerminal(id: string, checked: boolean): void {
    const isRola = this.trailerType === 'NON_LIFTABLE',
      list = isRola ? this.trailerRolaTerminalIds : this.trailerTerminalIds;
    const next = checked
      ? [...new Set([...list, id])]
      : list.filter((x) => String(x) !== String(id));
    if (isRola) this.trailerRolaTerminalIds = next;
    else this.trailerTerminalIds = next;
  }
  mapLeft(item: UnitTerminal): number {
    return item.longitude === null
      ? 50
      : Math.max(4, Math.min(96, ((Number(item.longitude) + 10) / 40) * 100));
  }
  mapTop(item: UnitTerminal): number {
    return item.latitude === null
      ? 50
      : Math.max(6, Math.min(94, ((72 - Number(item.latitude)) / 42) * 100));
  }
  mapsUrl(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
}
