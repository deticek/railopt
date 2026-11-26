import { apiRequest, readApiError } from './api-client';

export interface RoleRecord {
  roleId: number;
  role_name?: string;
  name?: string;
  permissions: string[];
  systemRole: boolean;
}
export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: number;
  active: boolean;
}
export interface AdminMessage {
  id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  message: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  admin_reply?: string | null;
  created_at: string;
}
export interface UnitTerminal {
  id: string;
  unitType: 'CONTAINER' | 'SWAP_BODY' | 'P400' | 'RO_LA';
  city: string;
  countryCode: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  cityDistanceKm?: number | null;
}
export interface NetworkTerminal {
  id: string;
  name: string;
  city: string;
  countryCode: string;
  address: string;
  latitude: number;
  longitude: number;
  unitTypes: Array<'CONTAINER' | 'SWAP_BODY' | 'P400' | 'OTHER'>;
  operator: string;
  services: string;
  handling: string[];
  source: string;
  approx: boolean;
}
export interface Trailer {
  id: string;
  name: string;
  registration: string | null;
  unitType: string;
  note?: string | null;
  active: boolean;
  terminalIds?: string[];
  rolaTerminalIds?: string[];
}
export interface Customer {
  id: string;
  name: string;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  active: boolean;
}
export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  entity: string;
  httpStatus: number;
  createdAt: string;
}
export interface BusinessShipment {
  id: string;
  shipmentNumber: number;
  route: string;
  loadingDate: string;
  deliveryDate: string;
  deadline: string;
  calculatedDeliveryAt: string | null;
  weightKg: number;
  unitType: string;
  adr: boolean;
  transportType: string | null;
  costEur: number | null;
  emissionsKgCo2e: number | null;
  businessStatus:
    'OFFER' | 'CONFIRMED' | 'ORDERED' | 'IN_TRANSIT' | 'DELIVERED' | 'INVOICED' | 'CANCELLED';
  carrier: string | null;
  sender: string | null;
  recipient: string | null;
  goods: string | null;
  soldPriceEur: number | null;
  actualCostEur: number | null;
  invoiceNumber: string | null;
  updatedAt?: string;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await apiRequest(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(await readApiError(response, 'Zahteve ni bilo mogoče izvesti.'));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const listRoles = () => request<RoleRecord[]>('/roles');
export const saveRole = (role: { roleId?: number; name: string; permissions: string[] }) =>
  request<RoleRecord>(
    role.roleId ? `/roles/${role.roleId}` : '/roles',
    role.roleId ? 'PUT' : 'POST',
    role,
  );
export const updateUser = (user: UserRecord) =>
  request<UserRecord>(`/users/${encodeURIComponent(user.id)}`, 'PUT', user);
export const deleteUser = (id: string) =>
  request<void>(`/users/${encodeURIComponent(id)}`, 'DELETE');
export const sendAdminMessage = (subject: string, message: string) =>
  request<{ id: string }>('/admin-messages', 'POST', { subject, message });
export const listAdminMessages = () => request<AdminMessage[]>('/admin-messages');
export const replyAdminMessage = (id: string, reply: string, status: 'ANSWERED' | 'CLOSED') =>
  request(`/admin-messages/${encodeURIComponent(id)}`, 'PUT', { reply, status });
export const listUnitTerminals = (type = '') =>
  request<UnitTerminal[]>(`/unit-terminals${type ? `?type=${encodeURIComponent(type)}` : ''}`);
export const listTerminalNetwork = () => request<NetworkTerminal[]>('/terminal-network');
export const listTrailers = () => request<Trailer[]>('/trailers');
export const saveTrailer = (
  trailer: Partial<Trailer> & { terminalIds?: string[]; rolaTerminalIds?: string[] },
) =>
  request<Trailer>(
    trailer.id ? `/trailers/${encodeURIComponent(trailer.id)}` : '/trailers',
    trailer.id ? 'PUT' : 'POST',
    trailer,
  );
export const listCustomers = () => request<Customer[]>('/customers');
export const saveCustomer = (customer: Partial<Customer>) =>
  request<Customer>(
    customer.id ? `/customers/${encodeURIComponent(customer.id)}` : '/customers',
    customer.id ? 'PUT' : 'POST',
    customer,
  );
export const getCustomerShipments = (id: string) =>
  request<
    Array<{
      id: number;
      shipment_number: number;
      loading_date: string;
      weight_kg: number;
      unit_type: string;
      loading_city: string;
      unloading_city: string;
    }>
  >(`/customers/${encodeURIComponent(id)}/shipments`);
export const saveCustomerShipments = (id: string, shipmentIds: Array<string | number>) =>
  request(`/customers/${encodeURIComponent(id)}/shipments`, 'PUT', { shipmentIds });
export const listAuditLogs = () => request<AuditEntry[]>('/audit-logs');
export const listBusinessShipments = () => request<BusinessShipment[]>('/shipments/business');
export const saveBusinessShipment = (shipment: BusinessShipment) =>
  request<BusinessShipment>(
    `/shipments/${encodeURIComponent(shipment.id)}/business`,
    'PUT',
    shipment,
  );
