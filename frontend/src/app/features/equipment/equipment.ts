import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { listTrailers, Trailer } from '../../core/api/admin-api';
interface TrailerSpec {
  id: string;
  name: string;
  category: string;
  uct: 'da' | 'zamenjava' | 'ne';
  length_m: number;
  width_m: number;
  height_m: number;
  tare_t: number;
  tractor_t: number;
  payload_t: number;
  pallets: number;
  volume_m3: number;
  adr: boolean;
  temp: boolean;
  note: string;
  source: string;
}
@Component({
  selector: 'app-equipment',
  standalone: true,
  imports: [DecimalPipe, FormsModule, RouterLink],
  templateUrl: './equipment.html',
  styleUrl: './equipment.scss',
})
export class EquipmentComponent implements OnInit {
  constructor(private readonly cd: ChangeDetectorRef) {}
  catalog: TrailerSpec[] = [];
  registered: Trailer[] = [];
  error = '';
  loading = true;
  filter = '';
  weightKg = 24000;
  adr = false;
  async ngOnInit(): Promise<void> {
    const jobs = await Promise.allSettled([
      fetch(new URL('assets/trailer-catalog.json', document.baseURI)).then((r) => {
        if (!r.ok) throw new Error('Katalog ni dosegljiv.');
        return r.json() as Promise<TrailerSpec[]>;
      }),
      listTrailers(),
    ]);
    if (jobs[0].status === 'fulfilled') this.catalog = jobs[0].value;
    else
      this.error =
        jobs[0].reason instanceof Error ? jobs[0].reason.message : 'Kataloga ni mogoče naložiti.';
    if (jobs[1].status === 'fulfilled') this.registered = jobs[1].value;
    this.loading = false;
    this.cd.markForCheck();
  }
  get visibleCatalog(): TrailerSpec[] {
    return this.catalog.filter((x) => !this.filter || x.category === this.filter);
  }
  icon(item: TrailerSpec): string {
    return item.category === 'zabojnik'
      ? '▣'
      : item.category === 'posebna'
        ? '⚙'
        : item.category === 'intermodalna'
          ? '⇄'
          : item.temp
            ? '❄'
            : item.category === 'odprta'
              ? '▱'
              : '▰';
  }
  maxRoad(item: TrailerSpec): boolean {
    return (
      this.weightKg <= item.payload_t * 1000 &&
      item.length_m <= 18.75 &&
      item.width_m <= 2.6 &&
      item.height_m <= 4 &&
      item.tare_t + item.tractor_t + this.weightKg / 1000 <= 40 &&
      (!this.adr || item.adr)
    );
  }
  maxTrain(item: TrailerSpec): boolean {
    return item.uct !== 'ne' && this.weightKg <= item.payload_t * 1000 && (!this.adr || item.adr);
  }
  maxRola(item: TrailerSpec): boolean {
    return (
      item.length_m <= 18.8 &&
      item.width_m <= 2.6 &&
      item.height_m <= 4 &&
      item.tare_t + item.tractor_t + this.weightKg / 1000 <= 40 &&
      (!this.adr || item.adr)
    );
  }
  suitability(item: TrailerSpec): string {
    return item.uct === 'da'
      ? 'Dvigljiva enota'
      : item.uct === 'zamenjava'
        ? 'Možen prevoz z ustrezno nadomestno dvigljivo enoto'
        : 'Ni dvigljiva';
  }
  track(_: number, item: { id: string }): string {
    return item.id;
  }
}
