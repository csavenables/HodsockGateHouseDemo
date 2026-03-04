import * as THREE from 'three';
import { ParticleIntroConfig } from '../config/schema';
import { SplatRevealBounds } from '../renderers/types';
import { easeInOutCubic } from '../utils/easing';

function hexToColor(value: string): THREE.Color {
  const color = new THREE.Color();
  try {
    color.set(value);
    return color;
  } catch {
    color.set('#ffdda8');
    return color;
  }
}

export class ParticleIntroController {
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private rafId = 0;

  constructor(private readonly scene: THREE.Scene) {}

  async play(
    sourcePoints: THREE.Vector3[],
    bounds: SplatRevealBounds,
    config: ParticleIntroConfig,
    reducedMotion: boolean,
    options: {
      anchor?: THREE.Object3D | null;
      sourceColors?: Float32Array | null;
    } = {},
  ): Promise<void> {
    this.disposeCurrent();
    if (reducedMotion || sourcePoints.length === 0) {
      return;
    }

    const count = Math.min(config.particleCount, sourcePoints.length);
    if (count <= 0) {
      return;
    }

    const from = new Float32Array(count * 3);
    const to = new Float32Array(count * 3);
    const current = new Float32Array(count * 3);
    const boundsHeight = Math.max(0.001, bounds.maxY - bounds.minY);
    const spreadRadius = Math.max(0.01, boundsHeight * config.spread);
    const color = hexToColor(config.color);
    const sourceColors = options.sourceColors ?? null;
    const hasPerPointColors = Boolean(sourceColors && sourceColors.length >= count * 3);

    for (let i = 0; i < count; i += 1) {
      const source = sourcePoints[i];
      const azimuth = Math.random() * Math.PI * 2;
      const elevation = Math.acos(2 * Math.random() - 1);
      const radial = spreadRadius * (0.4 + Math.random() * 0.6);
      const outward = new THREE.Vector3(
        Math.sin(elevation) * Math.cos(azimuth),
        Math.cos(elevation),
        Math.sin(elevation) * Math.sin(azimuth),
      ).multiplyScalar(radial);

      const base = i * 3;
      from[base] = source.x + outward.x;
      from[base + 1] = source.y + outward.y;
      from[base + 2] = source.z + outward.z;
      to[base] = source.x;
      to[base + 1] = source.y;
      to[base + 2] = source.z;
      current[base] = from[base];
      current[base + 1] = from[base + 1];
      current[base + 2] = from[base + 2];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(current, 3));
    if (hasPerPointColors && sourceColors) {
      const pointColors = new Float32Array(count * 3);
      pointColors.set(sourceColors.subarray(0, count * 3));
      this.geometry.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
    }
    this.material = new THREE.PointsMaterial({
      color,
      vertexColors: hasPerPointColors,
      size: Math.max(0.001, config.size),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      blending: config.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.renderOrder = -1;
    const anchor = options.anchor ?? null;
    if (anchor) {
      anchor.add(this.points);
    } else {
      this.scene.add(this.points);
    }

    const start = performance.now();
    const duration = Math.max(120, config.durationMs);
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const eased = easeInOutCubic(t);
        const outAttr = this.geometry?.getAttribute('position');
        if (outAttr instanceof THREE.BufferAttribute) {
          for (let i = 0; i < count; i += 1) {
            const base = i * 3;
            outAttr.array[base] = from[base] + (to[base] - from[base]) * eased;
            outAttr.array[base + 1] = from[base + 1] + (to[base + 1] - from[base + 1]) * eased;
            outAttr.array[base + 2] = from[base + 2] + (to[base + 2] - from[base + 2]) * eased;
          }
          outAttr.needsUpdate = true;
        }
        if (this.material) {
          this.material.opacity = 0.92;
        }

        if (t >= 1) {
          resolve();
          return;
        }
        this.rafId = requestAnimationFrame(step);
      };
      this.rafId = requestAnimationFrame(step);
    });
  }

  async cover(durationMs: number): Promise<void> {
    if (!this.material || !this.points) {
      return;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    const start = performance.now();
    const duration = Math.max(140, durationMs);
    const holdPhase = 0.25;
    const startOpacity = this.material.opacity;
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        const t = Math.min(1, (now - start) / duration);
        const fadeT = t <= holdPhase ? 0 : (t - holdPhase) / (1 - holdPhase);
        const eased = easeInOutCubic(fadeT);
        if (this.material) {
          this.material.opacity = startOpacity * (1 - eased);
        }
        if (t >= 1) {
          resolve();
          return;
        }
        this.rafId = requestAnimationFrame(step);
      };
      this.rafId = requestAnimationFrame(step);
    });
    this.disposeCurrent();
  }

  dispose(): void {
    this.disposeCurrent();
  }

  private disposeCurrent(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.points) {
      this.points.parent?.remove(this.points);
      this.points = null;
    }
    if (this.geometry) {
      this.geometry.dispose();
      this.geometry = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }
}
