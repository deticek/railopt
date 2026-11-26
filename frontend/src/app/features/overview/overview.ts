import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { formatDate, formatMoney } from '../../models';
import { getDashboard, DashboardData } from '../../core/api/transport-api';
@Component({ selector: 'app-overview', standalone: true, imports:[DatePipe], templateUrl: './overview.html',styleUrl:'./overview.scss' })
export class OverviewComponent implements OnInit {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}
  data: DashboardData | null = null;
  error = '';
  loading = true;
  async ngOnInit(): Promise<void> {
    try {
      this.data = await getDashboard();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Pregleda ni mogoče naložiti.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }
  date(value: string): string {
    return formatDate(value);
  }
  money(value: number | null): string {
    return formatMoney(value);
  }
  get monthlyBars():Array<{label:string;count:number;height:number;x:number}>{
    const source=new Map((this.data?.monthlyShipments||[]).map(x=>[x.period,x.count]));
    const now=new Date();const rows=[] as Array<{label:string;count:number;height:number;x:number}>;
    for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;rows.push({label:new Intl.DateTimeFormat('sl-SI',{month:'short'}).format(d),count:source.get(key)||0,height:0,x:0});}
    const max=Math.max(1,...rows.map(x=>x.count));return rows.map((r,i)=>({...r,height:Math.max(5,(r.count/max)*78),x:10+i*16}));
  }
  get roadChoiceCount():number{return (this.data?.transportBreakdown||[]).filter(x=>x.mode==='ROAD').reduce((sum,x)=>sum+x.count,0);}
  get railChoiceCount():number{return (this.data?.transportBreakdown||[]).filter(x=>x.mode!=='ROAD').reduce((sum,x)=>sum+x.count,0);}
  get roadUnfinishedCount():number{return (this.data?.transportBreakdown||[]).filter(x=>x.mode==='ROAD').reduce((sum,x)=>sum+x.unfinishedCount,0);}
  get railUnfinishedCount():number{return (this.data?.transportBreakdown||[]).filter(x=>x.mode!=='ROAD').reduce((sum,x)=>sum+x.unfinishedCount,0);}
  get totalBreakdown():number{return this.roadChoiceCount+this.railChoiceCount;}
  get roadChoicePercent():number{return this.totalBreakdown?Math.round(this.roadChoiceCount/this.totalBreakdown*100):0;}
  get railChoicePercent():number{return this.totalBreakdown?100-this.roadChoicePercent:0;}
}
