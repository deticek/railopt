export interface ExportRecord {
  category: string;
  label: string;
  route?: string;
  loadingAt?: string | null;
  deliveryAt?: string | null;
  unitType?: string | null;
  mode?: string | null;
  costEur?: number | string | null;
  emissionsKgCo2e?: number | string | null;
  data: unknown;
}

function quoteCsv(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function exportRecordsCsv(filename: string, records: ExportRecord[]): void {
  const header = ['Vrsta zapisa', 'Oznaka', 'Relacija', 'Naklad', 'Dostava / rok', 'Vrsta enote', 'Način', 'Strošek EUR', 'Emisije kg CO2e', 'Celotni podatki JSON'];
  const rows = records.map(row => [
    row.category, row.label, row.route, row.loadingAt, row.deliveryAt,
    row.unitType, row.mode, row.costEur, row.emissionsKgCo2e, row.data,
  ]);
  const csv = '\uFEFF' + [header, ...rows].map(row => row.map(quoteCsv).join(';')).join('\r\n');
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

export function exportJsonArchive(filename:string,archive:unknown):void{
  downloadBlob(filename,new Blob([JSON.stringify(archive,null,2)],{type:'application/json;charset=utf-8'}));
}

export function exportRecordsPdf(title: string, records: ExportRecord[]): void {
  const content = records.map((row, index) => `
    <section class="record ${index ? 'page-break' : ''}">
      <h2>${escapeHtml(row.category)} · ${escapeHtml(row.label)}</h2>
      <p><b>Relacija:</b> ${escapeHtml(row.route || '—')}</p>
      <p><b>Naklad:</b> ${escapeHtml(row.loadingAt || '—')} &nbsp; <b>Dostava / rok:</b> ${escapeHtml(row.deliveryAt || '—')}</p>
      <p><b>Vrsta enote:</b> ${escapeHtml(row.unitType || '—')} &nbsp; <b>Način:</b> ${escapeHtml(row.mode || '—')}</p>
      <p><b>Strošek:</b> ${escapeHtml(row.costEur ?? '—')} € &nbsp; <b>Emisije:</b> ${escapeHtml(row.emissionsKgCo2e ?? '—')} kg CO₂e</p>
      <h3>Vsi podatki in izračun</h3>
      <pre>${escapeHtml(JSON.stringify(row.data, null, 2))}</pre>
    </section>`).join('');
  const html = `<!doctype html><html lang="sl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font:12px Arial,sans-serif;color:#172033;margin:22px}h1{font-size:22px}h2{font-size:17px;border-bottom:1px solid #cbd5e1;padding-bottom:8px}h3{font-size:13px;margin-bottom:5px}p{margin:5px 0}.page-break{break-before:page}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:9px Consolas,monospace;background:#f3f5f8;padding:10px;border:1px solid #dce2ea;border-radius:4px}@media print{body{margin:12mm}.page-break{break-before:page}}
    </style></head><body><h1>${escapeHtml(title)}</h1><p>${records.length} zapisov · izdelano ${new Date().toLocaleString('sl-SI')}</p>${content}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Okno za tiskanje je blokirano. Dovoli pojavna okna in poskusi znova.');
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

export function exportBusinessDocument(kind:'offer'|'order'|'cmr'|'co2'|'invoice',shipment:any):void{
  const titles={offer:'Ponudba za prevoz',order:'Naročilo prevoza',cmr:'Tovorni list CMR · osnutek',co2:'Poročilo o emisijah CO₂e',invoice:'Račun · osnutek'};
  const esc=escapeHtml;
  const details=[['Številka pošiljke',`#${shipment.shipmentNumber}`],['Relacija',shipment.route],['Naklad',shipment.loadingDate],['Rok dostave',shipment.deadline],['Izračunan prihod',shipment.calculatedDeliveryAt||'Ni izračunan'],['Tovor',shipment.goods||'Ni vneseno'],['Teža',`${shipment.weightKg} kg`],['Enota',shipment.unitType],['ADR',shipment.adr?'Da':'Ne'],['Prevoznik',shipment.carrier||'Ni izbran'],['Pošiljatelj',shipment.sender||'Ni vnesen'],['Prejemnik',shipment.recipient||'Ni vnesen'],['Način prevoza',shipment.transportType||'Ni shranjen'],['Cena ponudbe',shipment.soldPriceEur==null?'Ni določena':`${Number(shipment.soldPriceEur).toFixed(2)} €`],['Dejanski strošek',shipment.actualCostEur==null?'Ni vnesen':`${Number(shipment.actualCostEur).toFixed(2)} €`],['CO₂e',shipment.emissionsKgCo2e==null?'Izračun pošiljke še ni na voljo':`${Number(shipment.emissionsKgCo2e).toFixed(1)} kg`],['Številka računa',shipment.invoiceNumber||'Ni vnesena']];
  const signature=kind==='cmr'?'<div class="signatures"><div>Prevzemnik · kraj, datum, podpis</div><div>Prevoznik · kraj, datum, podpis</div><div>Prejemnik · kraj, datum, podpis</div></div>':'';
  const note=kind==='cmr'||kind==='invoice'?'<p class="draft">OSNUTEK — pred uporabo dopolni zahtevane podatke ter preveri pravne in poslovne pogoje.</p>':'';
  const rows=details.map(([key,value])=>`<tr><th>${esc(key)}</th><td>${esc(value)}</td></tr>`).join('');
  const win=window.open('','_blank');if(!win)throw new Error('Okno za tiskanje je blokirano. Dovoli pojavna okna in poskusi znova.');
  win.document.open();win.document.write(`<!doctype html><html lang="sl"><head><meta charset="utf-8"><title>${esc(titles[kind])} · ${esc(shipment.shipmentNumber)}</title><style>body{font:14px Arial,sans-serif;color:#172033;margin:32px}header{display:flex;justify-content:space-between;border-bottom:3px solid #5368e8;padding-bottom:14px}h1{font-size:25px;margin:4px 0}small{color:#667085}.brand{font-size:18px;font-weight:bold;color:#5368e8}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;padding:10px;border-bottom:1px solid #d9deea}th{width:28%;color:#526079;background:#f5f6fa}.draft{margin-top:24px;padding:12px;background:#fff4dd;color:#854d0e;border:1px solid #f0d6a4}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:70px}.signatures div{border-top:1px solid #596579;padding-top:8px;color:#566174;font-size:12px}@media print{body{margin:15mm}}</style></head><body><header><div><span class="brand">RAILOPT · TIM</span><h1>${esc(titles[kind])}</h1><small>Referenca pošiljke #${esc(shipment.shipmentNumber)} · ${esc(new Date().toLocaleDateString('sl-SI'))}</small></div><b>${esc(shipment.businessStatus||'OFFER')}</b></header><table>${rows}</table>${signature}${note}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`);win.document.close();
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

export function makeShipmentExportRecord(shipment: any, calculation?: unknown, calculationError?: string): ExportRecord {
  const data = { shipment, calculation: calculation ?? null, calculationError: calculationError || null };
  const result = (calculation as any)?.result;
  const selected = result?.options?.find((option: any) => option.id === result.selectedOptionId) || result?.options?.[0];
  return {
    category: 'Pošiljka', label: shipment.code || String(shipment.id), route: shipment.route,
    loadingAt: shipment.loadingDate, deliveryAt: result?.deliveryAt || shipment.calculatedDeliveryAt || shipment.deliveryDateRaw,
    unitType: shipment.unitType, mode: selected?.title || shipment.mode,
    costEur: selected?.cost?.totalEur ?? shipment.cost,
    emissionsKgCo2e: selected?.emissionsKgCo2e ?? shipment.co2,
    data,
  };
}

export function makePlanExportRecord(plan: any): ExportRecord {
  const selected = plan.result?.options?.find((option: any) => option.id === plan.result?.selectedOptionId) || plan.result?.options?.[0];
  return {
    category: 'Izračun planerja', label: plan.id,
    route: `${plan.origin} → ${plan.destination}`,
    loadingAt: plan.result?.actualLoadingAt || plan.loadingAt,
    deliveryAt: selected?.deliveryAt || plan.result?.deliveryAt,
    unitType: plan.unitType, mode: selected?.title,
    costEur: selected?.cost?.totalEur, emissionsKgCo2e: selected?.emissionsKgCo2e,
    data: plan,
  };
}

export function makeRouteExportRecord(route: any): ExportRecord {
  return {
    category: 'Relacija iz baze', label: route.code || String(route.id),
    route: `${route.from} → ${route.to}`, unitType: route.unitType,
    data: route,
  };
}
