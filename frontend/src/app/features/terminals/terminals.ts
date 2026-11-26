import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { listTerminalNetwork, listUnitTerminals, NetworkTerminal, UnitTerminal } from '../../core/api/admin-api';

interface Tile { url: string; x: number; y: number; }
interface MapTerminal {
  id: string; name: string; city: string; countryCode: string; address: string;
  latitude: number|null; longitude: number|null; unitTypes: string[];
  operator?: string; services?: string; handling?: string[]; source?: string; approx?: boolean;
}
interface TerminalCluster { key: string; latitude: number; longitude: number; terminals: MapTerminal[]; }

@Component({selector:'app-terminal-map',standalone:true,imports:[FormsModule],templateUrl:'./terminals.html',styleUrl:'./terminals.scss'})
export class TerminalMapComponent implements OnInit {
  constructor(private readonly cd:ChangeDetectorRef){}
  terminals:MapTerminal[]=[];selected:MapTerminal|null=null;error='';loading=true;query='';country='';types=new Set<string>();zoom=-1;panX=0;panY=0;
  private drag:{x:number;y:number;px:number;py:number}|null=null;
  readonly width=1000;readonly height=650;
  async ngOnInit():Promise<void>{
    try{
      const [network,rola]=await Promise.all([listTerminalNetwork(),listUnitTerminals('RO_LA')]);
      this.terminals=[...network.map(t=>this.fromNetwork(t)),...rola.map(t=>this.fromRola(t))];
      this.types=new Set(this.terminals.flatMap(t=>t.unitTypes));
    }catch(e){this.error=e instanceof Error?e.message:'Terminalov ni mogoče naložiti.';}
    finally{this.loading=false;this.cd.markForCheck();}
  }
  private fromNetwork(t:NetworkTerminal):MapTerminal{return{...t,id:`network:${t.id}`,unitTypes:t.unitTypes};}
  private fromRola(t:UnitTerminal):MapTerminal{return{...t,id:`rola:${t.id}`,unitTypes:['RO_LA']};}
  get countries():string[]{return [...new Set(this.terminals.map(x=>x.countryCode).filter(Boolean))].sort();}
  get unitTypes():string[]{return [...new Set(this.terminals.flatMap(t=>t.unitTypes))].sort();}
  typeLabel(type:string):string{return({RO_LA:'Ro-La',P400:'Polprikolice (P400)',SWAP_BODY:'Zamenljivi zaboj',CONTAINER:'Zabojniki',OTHER:'Intermodalni terminal (oprema ni navedena)'} as Record<string,string>)[type]||type.replaceAll('_',' ');}
  terminalTypes(t:MapTerminal):string{return t.unitTypes.map(x=>this.typeLabel(x)).join(', ');}
  get visible():MapTerminal[]{const q=this.query.trim().toLocaleLowerCase('sl-SI');return this.terminals.filter(t=>t.unitTypes.some(type=>this.types.has(type))&&(!this.country||t.countryCode===this.country)&&(!q||`${t.name} ${t.city} ${t.address} ${t.operator||''}`.toLocaleLowerCase('sl-SI').includes(q)));}
  get terminalClusters():TerminalCluster[]{const groups=new Map<string,TerminalCluster>();for(const terminal of this.visible){if(terminal.latitude==null||terminal.longitude==null)continue;const latitude=Number(terminal.latitude),longitude=Number(terminal.longitude);if(!Number.isFinite(latitude)||!Number.isFinite(longitude))continue;const key=`${latitude.toFixed(4)},${longitude.toFixed(4)}`;const cluster=groups.get(key)??{key,latitude,longitude,terminals:[]};cluster.terminals.push(terminal);groups.set(key,cluster);}return [...groups.values()];}
  get terminalsWithoutCoordinates():number{return this.visible.filter(t=>t.latitude==null||t.longitude==null||!Number.isFinite(Number(t.latitude))||!Number.isFinite(Number(t.longitude))).length;}
  get selectedCluster():TerminalCluster|undefined{return this.terminalClusters.find(c=>c.terminals.some(t=>t.id===this.selected?.id));}
  setType(type:string,on:boolean):void{if(on)this.types.add(type);else this.types.delete(type);}
  project(lat:number,lon:number):{x:number;y:number}{const z=Math.max(2,Math.min(9,4+this.zoom)),scale=256*2**z;const clamped=Math.max(-85,Math.min(85,lat));const sin=Math.sin(clamped*Math.PI/180);const wx=((lon+180)/360)*scale;const wy=(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale;const centerLon=10,centerLat=49,cSin=Math.sin(centerLat*Math.PI/180);const cx=((centerLon+180)/360)*scale,cy=(.5-Math.log((1+cSin)/(1-cSin))/(4*Math.PI))*scale;return{x:wx-cx+this.width/2+this.panX,y:wy-cy+this.height/2+this.panY};}
  get tiles():Tile[]{const z=Math.max(2,Math.min(9,4+this.zoom)),scale=256*2**z;const cSin=Math.sin(49*Math.PI/180),cx=((10+180)/360)*scale,cy=(.5-Math.log((1+cSin)/(1-cSin))/(4*Math.PI))*scale-this.panY;const cxPan=cx-this.panX;const left=Math.floor((cxPan-this.width/2)/256),top=Math.floor((cy-this.height/2)/256),rows:Tile[]=[];for(let x=left;x<=left+Math.ceil(this.width/256);x++)for(let y=top;y<=top+Math.ceil(this.height/256);y++){if(y<0||y>=2**z)continue;const wrapped=((x%(2**z))+(2**z))%(2**z);rows.push({url:`https://tile.openstreetmap.org/${z}/${wrapped}/${y}.png`,x:x*256-(cxPan-this.width/2),y:y*256-(cy-this.height/2)});}return rows;}
  clusterPosition(cluster:TerminalCluster):{x:number;y:number}{return this.project(cluster.latitude,cluster.longitude);}
  selectCluster(cluster:TerminalCluster):void{this.selected=cluster.terminals[0]??null;}
  zoomBy(delta:number,event?:WheelEvent|MouseEvent):void{event?.preventDefault();event?.stopPropagation();this.zoom=Math.max(-2,Math.min(5,this.zoom+delta));}
  panStart(e:PointerEvent):void{if((e.target as HTMLElement).closest('button'))return;this.drag={x:e.clientX,y:e.clientY,px:this.panX,py:this.panY};(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}
  panMove(e:PointerEvent):void{if(!this.drag)return;this.panX=this.drag.px+(e.clientX-this.drag.x);this.panY=this.drag.py+(e.clientY-this.drag.y);}
  panEnd():void{this.drag=null;}
  markerLabel(t:MapTerminal):string{return `${t.name} · ${t.city} (${t.countryCode}) · ${this.terminalTypes(t)}`;}
  mapUrl(t:MapTerminal):string{return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.latitude},${t.longitude}`)}`;}
  track(_:number,t:MapTerminal):string{return t.id;}
}
