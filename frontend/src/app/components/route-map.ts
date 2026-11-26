import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import type { RouteMapPoint, RouteMapSegment } from '../core/api/delivery-plans-api';

interface Tile {
  url: string;
  x: number;
  y: number;
}
interface ScreenPoint {
  x: number;
  y: number;
  label?: string;
  kind?: string;
}

@Component({
  selector: 'app-route-map',
  standalone: true,
  templateUrl: './route-map.html',
  styleUrl: './route-map.scss',
})
export class RouteMapComponent implements OnChanges {
  @Input() segments: RouteMapSegment[] = [];
  @Input() points: RouteMapPoint[] = [];
  @Input() title = 'Pot pošiljke';
  private readonly width = 1000;
  private readonly height = 460;
  zoomDelta = 0;
  offsetX = 0;
  offsetY = 0;
  private drag: { x: number; y: number; offsetX: number; offsetY: number } | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['title']) return;
    this.zoomDelta = 0;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  private project(lat: number, lon: number, zoom: number): { x: number; y: number } {
    const n = 2 ** zoom;
    const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
    const sin = Math.sin((clamped * Math.PI) / 180);
    return {
      x: ((lon + 180) / 360) * n * 256,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * 256,
    };
  }

  private get bounds(): { west: number; east: number; north: number; south: number } {
    const coordinates = [
      ...this.points.map((point) => [point.lat, point.lon] as [number, number]),
      ...this.segments.flatMap((segment) => segment.coordinates || []),
    ].filter((point) => Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
    if (!coordinates.length) return { west: 13, east: 14, north: 49, south: 48 };
    return {
      west: Math.min(...coordinates.map((point) => point[1])),
      east: Math.max(...coordinates.map((point) => point[1])),
      north: Math.max(...coordinates.map((point) => point[0])),
      south: Math.min(...coordinates.map((point) => point[0])),
    };
  }

  private get baseZoom(): number {
    const bounds = this.bounds;
    const northWest = this.project(bounds.north, bounds.west, 0);
    const southEast = this.project(bounds.south, bounds.east, 0);
    const spanX = Math.max(0.002, Math.abs(southEast.x - northWest.x));
    const spanY = Math.max(0.002, Math.abs(southEast.y - northWest.y));
    const fit = Math.min(this.width / (spanX * 256), this.height / (spanY * 256)) * 0.8;
    return Math.max(3, Math.min(16, Math.floor(Math.log2(Math.max(1, fit)))));
  }

  private get zoom(): number {
    return Math.max(3, Math.min(18, this.baseZoom + this.zoomDelta));
  }

  private get center(): { x: number; y: number } {
    const bounds = this.bounds;
    const center = this.project(
      (bounds.north + bounds.south) / 2,
      (bounds.west + bounds.east) / 2,
      this.zoom,
    );
    return { x: center.x + this.offsetX, y: center.y + this.offsetY };
  }

  zoomBy(delta: number, event?: WheelEvent | MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.zoomDelta = Math.max(-8, Math.min(10, this.zoomDelta + delta));
  }

  panStart(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('button')) return;
    this.drag = {
      x: event.clientX,
      y: event.clientY,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  panMove(event: PointerEvent): void {
    if (!this.drag) return;
    this.offsetX = this.drag.offsetX - (event.clientX - this.drag.x);
    this.offsetY = this.drag.offsetY - (event.clientY - this.drag.y);
  }

  panEnd(): void {
    this.drag = null;
  }

  get tiles(): Tile[] {
    const zoom = this.zoom;
    const center = this.center;
    const n = 2 ** zoom;
    const leftTile = Math.floor((center.x - this.width / 2) / 256);
    const topTile = Math.floor((center.y - this.height / 2) / 256);
    const tiles: Tile[] = [];
    for (let x = leftTile; x <= leftTile + Math.ceil(this.width / 256); x++) {
      for (let y = topTile; y <= topTile + Math.ceil(this.height / 256); y++) {
        if (y < 0 || y >= n) continue;
        const wrappedX = ((x % n) + n) % n;
        tiles.push({
          url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
          x: x * 256 - (center.x - this.width / 2),
          y: y * 256 - (center.y - this.height / 2),
        });
      }
    }
    return tiles;
  }

  line(segment: RouteMapSegment): string {
    const center = this.center;
    return (segment.coordinates || [])
      .map(([lat, lon], index) => {
        const point = this.project(Number(lat), Number(lon), this.zoom);
        const x = point.x - center.x + this.width / 2;
        const y = point.y - center.y + this.height / 2;
        return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  get markers(): ScreenPoint[] {
    const center = this.center;
    return this.points.map((point) => {
      const projected = this.project(point.lat, point.lon, this.zoom);
      return {
        x: projected.x - center.x + this.width / 2,
        y: projected.y - center.y + this.height / 2,
        label: point.label,
        kind: point.kind,
      };
    });
  }
}
