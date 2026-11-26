import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlacePickerComponent } from '../components/place-picker/place-picker';
import {
  createRailDisruption, createRoadDisruption, listRailDisruptions, listRailTerminals,
  listRoadDisruptions, removeRailDisruption, removeRoadDisruption,
  type PlaceSelection, type RailDisruption, type RailNetworkTerminal, type RoadDisruption,
} from '../core/api/delivery-plans-api';

function localInputDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-disruptions', standalone: true,
  imports: [DatePipe, FormsModule, PlacePickerComponent],
  templateUrl: './disruptions.html', styleUrl: './disruptions.scss',
})
export class DisruptionsComponent implements OnInit {
  constructor(private readonly changeDetector: ChangeDetectorRef) {}
  tab: 'road' | 'rail' = 'road';
  loading = true;
  saving = false;
  error = '';
  message = '';
  railTerminals: RailNetworkTerminal[] = [];
  railDisruptions: RailDisruption[] = [];
  roadDisruptions: RoadDisruption[] = [];
  railA = '';
  railB = '';
  railCountryA = '';
  railCountryB = '';
  railStartsAt = localInputDate(new Date());
  railEndsAt = localInputDate(new Date(Date.now() + 24 * 3600000));
  railNote = '';
  roadName = '';
  roadLocation: PlaceSelection | null = null;
  roadBypass: PlaceSelection | null = null;
  roadStartsAt = localInputDate(new Date());
  roadEndsAt = localInputDate(new Date(Date.now() + 24 * 3600000));
  roadRadiusKm = 2;
  roadNote = '';

  private readonly countryNames: Record<string, string> = {
    AT: 'Avstrija', BE: 'Belgija', BG: 'Bolgarija', CH: 'Švica', CZ: 'Češka',
    DE: 'Nemčija', DK: 'Danska', ES: 'Španija', FI: 'Finska', FR: 'Francija',
    GB: 'Združeno kraljestvo', GR: 'Grčija', HR: 'Hrvaška', HU: 'Madžarska',
    IT: 'Italija', NL: 'Nizozemska', NO: 'Norveška', PL: 'Poljska', PT: 'Portugalska',
    RO: 'Romunija', RS: 'Srbija', SE: 'Švedska', SI: 'Slovenija', SK: 'Slovaška',
    TR: 'Turčija', UA: 'Ukrajina',
  };

  get railCountries(): Array<{ code: string; label: string }> {
    return [...new Set(this.railTerminals.map(item => item.countryCode || 'UNKNOWN'))]
      .map(code => ({ code, label: code === 'UNKNOWN' ? 'Država ni določena' : `${this.countryNames[code] || code} (${code})` }))
      .sort((a, b) => a.label.localeCompare(b.label, 'sl', { sensitivity: 'base' }));
  }

  terminalsFor(side: 'a' | 'b'): RailNetworkTerminal[] {
    const country = side === 'a' ? this.railCountryA : this.railCountryB;
    return this.railTerminals.filter(item => (item.countryCode || 'UNKNOWN') === country);
  }

  selectRailCountry(side: 'a' | 'b', country: string): void {
    const choices = this.railTerminals.filter(item => (item.countryCode || 'UNKNOWN') === country);
    const otherId = side === 'a' ? this.railB : this.railA;
    const selected = choices.find(item => item.id !== otherId) || choices[0];
    if (side === 'a') { this.railCountryA = country; this.railA = selected?.id || ''; }
    else { this.railCountryB = country; this.railB = selected?.id || ''; }
  }

  async ngOnInit(): Promise<void> { await this.reload(); }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [terminals, rail, road] = await Promise.all([
        listRailTerminals(), listRailDisruptions(), listRoadDisruptions(),
      ]);
      this.railTerminals = terminals
        .filter(item => Boolean(item.activeInSourceWeek))
        .sort((a, b) => a.name.localeCompare(b.name, 'sl', { sensitivity: 'base' }));
      this.railDisruptions = rail;
      this.roadDisruptions = road.filter(item => item.active !== false);
      this.railCountryA ||= this.railCountries[0]?.code || '';
      this.railCountryB ||= this.railCountries.find(item => item.code !== this.railCountryA)?.code || this.railCountryA;
      this.railA ||= this.terminalsFor('a')[0]?.id || '';
      this.railB ||= this.terminalsFor('b').find(item => item.id !== this.railA)?.id || this.terminalsFor('b')[0]?.id || '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Motenj ni bilo mogoče naložiti.';
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async addRail(): Promise<void> {
    if (this.saving) return;
    if (!this.railA || !this.railB || this.railA === this.railB) { this.error = 'Izberi dve različni postaji za zaprt odsek.'; return; }
    this.saving = true; this.error = ''; this.message = '';
    try {
      await createRailDisruption({ terminalA: this.railA, terminalB: this.railB, startsAt: this.railStartsAt, endsAt: this.railEndsAt, note: this.railNote.trim() });
      this.railNote = '';
      this.railDisruptions = await listRailDisruptions();
      this.message = 'Železniška motnja je shranjena. Pri preračunu jo bo planer upošteval.';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Železniške motnje ni bilo mogoče shraniti.'; }
    finally { this.saving = false; this.changeDetector.markForCheck(); }
  }

  async addRoad(): Promise<void> {
    if (this.saving) return;
    if (!this.roadLocation || !this.roadBypass) { this.error = 'Izberi lokacijo zapore in točko, skozi katero naj gre obvoz.'; return; }
    this.saving = true; this.error = ''; this.message = '';
    try {
      await createRoadDisruption({
        name: this.roadName.trim(), location: this.roadLocation, bypass: this.roadBypass,
        startsAt: this.roadStartsAt, endsAt: this.roadEndsAt, radiusKm: Number(this.roadRadiusKm), note: this.roadNote.trim(),
      });
      this.roadName = ''; this.roadNote = ''; this.roadLocation = null; this.roadBypass = null;
      this.roadDisruptions = (await listRoadDisruptions()).filter(item => item.active !== false);
      this.message = 'Cestna motnja je shranjena. Na cestni trasi bo uporabljen izbrani obvoz.';
    } catch (error) { this.error = error instanceof Error ? error.message : 'Cestne motnje ni bilo mogoče shraniti.'; }
    finally { this.saving = false; this.changeDetector.markForCheck(); }
  }

  async removeRail(id: string): Promise<void> {
    try { await removeRailDisruption(id); this.railDisruptions = this.railDisruptions.filter(item => item.id !== id); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Motnje ni bilo mogoče odstraniti.'; }
  }

  async removeRoad(id: string): Promise<void> {
    try { await removeRoadDisruption(id); this.roadDisruptions = this.roadDisruptions.filter(item => item.id !== id); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Motnje ni bilo mogoče odstraniti.'; }
  }
}
