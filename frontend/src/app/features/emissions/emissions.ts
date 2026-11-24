import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  calculateRoadEmissions,
  googleMapsSearchUrl,
  type RoadEmissionResult,
} from '../../core/api/emissions-api';

@Component({
  selector: 'app-emissions',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './emissions.html',
  styleUrl: './emissions.scss',
})
export class EmissionsComponent implements OnDestroy {
  origin = '';
  destination = '';
  weightKg = 24000;
  readonly result = signal<RoadEmissionResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly progress = signal('');
  readonly elapsedSeconds = signal(0);
  private timer?: ReturnType<typeof setInterval>;

  mapsUrl(value: string): string {
    return googleMapsSearchUrl(value);
  }

  async calculate(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.result.set(null);
    this.progress.set('Vzpostavljam povezavo z aplikacijskim API-jem…');
    this.elapsedSeconds.set(0);
    this.timer = setInterval(() => this.elapsedSeconds.update((seconds) => seconds + 1), 1000);
    try {
      const result = await calculateRoadEmissions(
        this.origin,
        this.destination,
        this.weightKg,
        (message) => this.progress.set(message),
      );
      this.result.set(result);
      this.progress.set('Izračun je končan.');
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Cestne razdalje ni bilo mogoče izračunati.',
      );
    } finally {
      this.loading.set(false);
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
