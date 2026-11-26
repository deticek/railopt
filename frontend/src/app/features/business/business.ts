import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BusinessShipment, listBusinessShipments, saveBusinessShipment } from '../../core/api/admin-api';
import { exportBusinessDocument, exportRecordsCsv, exportRecordsPdf, type ExportRecord } from '../../core/export-data';

const states: Array<{id:BusinessShipment['businessStatus'];label:string}> = [
  {id:'OFFER',label:'Ponudba'},{id:'CONFIRMED',label:'Potrjeno'},{id:'ORDERED',label:'Naročeno'},{id:'IN_TRANSIT',label:'Na poti'},{id:'DELIVERED',label:'Dostavljeno'},{id:'INVOICED',label:'Obračunano'},{id:'CANCELLED',label:'Preklicano'},
];

@Component({selector:'app-business',standalone:true,imports:[FormsModule,DatePipe,DecimalPipe],templateUrl:'./business.html',styleUrl:'./business.scss'})
export class BusinessComponent implements OnInit {
  constructor(private readonly changeDetector:ChangeDetectorRef){}
  rows:BusinessShipment[]=[]; loading=true; error=''; message=''; savingId=''; readonly states=states;
  readonly canWrite=Number(sessionStorage.getItem('railopt-role'))===1||sessionStorage.getItem('railopt-permissions')?.split(',').includes('shipments.write')===true;
  async ngOnInit():Promise<void>{try{this.rows=await listBusinessShipments();}catch(e){this.error=e instanceof Error?e.message:'Poslovnega pregleda ni mogoče naložiti.';}finally{this.loading=false;this.changeDetector.markForCheck();}}
  async save(row:BusinessShipment):Promise<void>{this.savingId=row.id;this.error='';this.message='';try{Object.assign(row,await saveBusinessShipment(row));this.message=`Pošiljka #${row.shipmentNumber} je shranjena.`;}catch(e){this.error=e instanceof Error?e.message:'Poslovnih podatkov ni bilo mogoče shraniti.';}finally{this.savingId='';this.changeDetector.markForCheck();}}
  export(format:'csv'|'pdf'):void{const records=this.rows.map(row=>this.record(row));if(format==='csv')exportRecordsCsv('poslovni_potek_posiljk.csv',records);else exportRecordsPdf('Poslovni potek pošiljk',records);}
  document(row:BusinessShipment,kind:'offer'|'order'|'cmr'|'co2'|'invoice'):void{exportBusinessDocument(kind,row);}
  private record(row:BusinessShipment):ExportRecord{return {category:'Pošiljka',label:`#${row.shipmentNumber} · ${this.label(row.businessStatus)}`,route:row.route,loadingAt:row.loadingDate,deliveryAt:row.deadline,unitType:row.unitType,mode:'',costEur:row.soldPriceEur,emissionsKgCo2e:null,data:{status:this.label(row.businessStatus),carrier:row.carrier,sender:row.sender,recipient:row.recipient,goods:row.goods,soldPriceEur:row.soldPriceEur,actualCostEur:row.actualCostEur,invoiceNumber:row.invoiceNumber,weightKg:row.weightKg,adr:row.adr}};}
  label(value:string):string{return states.find(state=>state.id===value)?.label||value;}
  track(_:number,row:BusinessShipment):string{return row.id;}
}
