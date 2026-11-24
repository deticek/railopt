import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { getShipments } from '../../core/api/transport-api';
import { Shipment } from '../../models';
@Component({ selector: 'app-shipments', standalone: true, imports: [FormsModule], templateUrl: './shipments.html' })
export class ShipmentsComponent implements OnInit {
  rows: Shipment[] = []; query = ''; loading = true; error = '';
  get filtered(): Shipment[] { const q = this.query.trim().toLocaleLowerCase('sl'); return this.rows.filter(row => !q || (row.code + ' ' + row.route + ' ' + row.status).toLocaleLowerCase('sl').includes(q)); }
  async ngOnInit(): Promise<void> { try { this.rows = await getShipments(); } catch (e) { this.error = e instanceof Error ? e.message : 'Pošiljk ni mogoče naložiti.'; } finally { this.loading = false; } }
}
