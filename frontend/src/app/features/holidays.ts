import { Component, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { apiRequest, readApiError } from '../core/api/api-client';

interface HolidayRow {
  country_code: string;
  holiday_date: string;
  holiday_name: string;
  note: string | null;
}

@Component({
  selector: 'app-holidays',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './holidays.html',
  styleUrl: './holidays.scss',
})
export class HolidaysComponent implements OnInit {
  rows: HolidayRow[] = [];
  countryCode = 'SI';
  date = '';
  name = '';
  region = '';
  note = '';
  loading = true;
  saving = false;
  error = '';
  message = '';

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const response = await apiRequest('/holidays');
      if (!response.ok)
        throw new Error(await readApiError(response, 'Koledarja praznikov ni mogoče naložiti.'));
      this.rows = ((await response.json()) as HolidayRow[]).map((row) => ({
        ...row,
        holiday_date: String(row.holiday_date).slice(0, 10),
      }));
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Koledarja praznikov ni mogoče naložiti.';
    } finally {
      this.loading = false;
    }
  }

  regionName(row: HolidayRow): string {
    return row.note?.match(/^regionalno\s*:\s*([^;|]+)/i)?.[1]?.trim() || '';
  }

  async add(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.error = '';
    this.message = '';
    const region = this.region.trim();
    const note = region
      ? `regionalno: ${region}${this.note.trim() ? `; ${this.note.trim()}` : ''}`
      : this.note.trim();
    try {
      const response = await apiRequest('/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode: this.countryCode,
          date: this.date,
          name: this.name.trim(),
          note,
        }),
      });
      if (!response.ok)
        throw new Error(await readApiError(response, 'Praznika ni bilo mogoče shraniti.'));
      this.name = '';
      this.note = '';
      this.region = '';
      this.message = 'Prosti dan je shranjen in bo upoštevan pri naslednjih izračunih.';
      await this.reload();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Praznika ni bilo mogoče shraniti.';
    } finally {
      this.saving = false;
    }
  }

  async remove(row: HolidayRow): Promise<void> {
    this.error = '';
    const query = new URLSearchParams({ countryCode: row.country_code, date: row.holiday_date });
    try {
      const response = await apiRequest(`/holidays?${query}`, { method: 'DELETE' });
      if (!response.ok)
        throw new Error(await readApiError(response, 'Prostega dne ni bilo mogoče odstraniti.'));
      this.rows = this.rows.filter(
        (item) => item.country_code !== row.country_code || item.holiday_date !== row.holiday_date,
      );
      this.message = 'Prosti dan je odstranjen iz koledarja.';
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : 'Prostega dne ni bilo mogoče odstraniti.';
    }
  }
}
