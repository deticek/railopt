import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { listParameters, ParameterRecord, updateParameter } from './parameters-api';
@Component({
  selector: 'app-parameters',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './parameters.html',
  styleUrl: './parameters.scss',
})
export class ParametersComponent implements OnInit {
  constructor(private readonly cd: ChangeDetectorRef) {}
  rows: ParameterRecord[] = [];
  loading = true;
  error = '';
  message = '';
  saving = '';
  readonly isAdmin = Number(sessionStorage.getItem('railopt-role')) === 1;
  async ngOnInit(): Promise<void> {
    try {
      this.rows = await listParameters();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Parametrov ni mogoče prebrati.';
    } finally {
      this.loading = false;
      this.cd.markForCheck();
    }
  }
  groups(): string[] {
    return [...new Set(this.rows.map((x) => x.parameter_group))];
  }
  valueLabel(row: ParameterRecord): string {
    const n = row.numeric_value;
    if (n !== null && row.unit?.toLowerCase() === 'min' && n === 60) return '1 h (60 min)';
    if (n !== null) return new Intl.NumberFormat('sl-SI', { maximumFractionDigits: 2 }).format(n);
    return row.value || '—';
  }
  inGroup(group: string): ParameterRecord[] {
    return this.rows.filter((x) => x.parameter_group === group);
  }
  async save(row: ParameterRecord): Promise<void> {
    this.saving = row.parameter_code;
    this.error = '';
    this.message = '';
    try {
      await updateParameter(row.parameter_code, row.value);
      this.message = `»${row.parameter_name}« je posodobljen.`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Spremembe ni bilo mogoče shraniti.';
    } finally {
      this.saving = '';
      this.cd.markForCheck();
    }
  }
  track(_: number, row: ParameterRecord): string {
    return row.parameter_code;
  }
}
