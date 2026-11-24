import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { formatDate, formatMoney } from '../../models';
import { getDashboard, DashboardData } from '../../core/api/transport-api';
@Component({ selector: 'app-overview', standalone: true, templateUrl: './overview.html' })
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
}
