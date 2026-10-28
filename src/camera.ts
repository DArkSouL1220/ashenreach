import { MAP_H, MAP_W, TILE } from './map';
import { clamp } from './math';

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.2;

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  w = 1;
  h = 1;

  toWorld(sx: number, sy: number) {
    return { x: sx / this.zoom + this.x, y: sy / this.zoom + this.y };
  }

  toScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  centerOn(wx: number, wy: number) {
    this.x = wx - this.w / 2 / this.zoom;
    this.y = wy - this.h / 2 / this.zoom;
    this.clampToMap();
  }

  pan(dx: number, dy: number) {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.clampToMap();
  }

  zoomAt(sx: number, sy: number, factor: number) {
    this.setZoomAt(sx, sy, this.zoom * factor);
  }

  setZoomAt(sx: number, sy: number, zoom: number) {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToMap();
  }

  clampToMap() {
    const vw = this.w / this.zoom, vh = this.h / this.zoom;
    const maxX = MAP_W * TILE - vw, maxY = MAP_H * TILE - vh;
    this.x = maxX < 0 ? maxX / 2 : clamp(this.x, 0, maxX);
    this.y = maxY < 0 ? maxY / 2 : clamp(this.y, 0, maxY);
  }
}
