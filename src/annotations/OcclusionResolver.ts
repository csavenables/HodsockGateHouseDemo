import * as THREE from 'three';
import { OcclusionSamplePoint } from './AnnotationTypes';

const DEFAULT_SAMPLE_INTERVAL_MS = 1000 / 15;
const DEPTH_DOWNSAMPLE = 0.25;

export class OcclusionResolver {
  private renderTarget: THREE.WebGLRenderTarget | null = null;
  private readonly depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    blending: THREE.NoBlending,
  });
  private readonly pixel = new Uint8Array(4);
  private readonly occlusionById = new Map<string, boolean>();
  private nextSampleAtMs = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  resolve(
    samples: OcclusionSamplePoint[],
    width: number,
    height: number,
    epsilon: number,
    nowMs: number,
  ): Map<string, boolean> {
    if (nowMs >= this.nextSampleAtMs) {
      this.nextSampleAtMs = nowMs + DEFAULT_SAMPLE_INTERVAL_MS;
      this.updateDepthMap(samples, width, height, epsilon);
    }
    return this.occlusionById;
  }

  dispose(): void {
    this.renderTarget?.dispose();
    this.renderTarget = null;
    this.depthMaterial.dispose();
    this.occlusionById.clear();
  }

  private updateDepthMap(samples: OcclusionSamplePoint[], width: number, height: number, epsilon: number): void {
    this.ensureRenderTarget(width, height);
    if (!this.renderTarget) {
      return;
    }

    const targetWidth = this.renderTarget.width;
    const targetHeight = this.renderTarget.height;
    const previousTarget = this.renderer.getRenderTarget();
    const previousAutoClear = this.renderer.autoClear;
    const previousOverride = this.scene.overrideMaterial;
    try {
      this.renderer.autoClear = true;
      this.scene.overrideMaterial = this.depthMaterial;
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);

      for (const sample of samples) {
        if (!sample.visible) {
          this.occlusionById.set(sample.id, false);
          continue;
        }
        const px = Math.round(sample.x * (targetWidth - 1));
        const py = Math.round(sample.y * (targetHeight - 1));
        const sx = THREE.MathUtils.clamp(px, 0, targetWidth - 1);
        const sy = THREE.MathUtils.clamp(targetHeight - 1 - py, 0, targetHeight - 1);
        this.renderer.readRenderTargetPixels(this.renderTarget, sx, sy, 1, 1, this.pixel);
        const sampledDepth = unpackRGBADepth(this.pixel);
        const occluded = sample.ndcDepth > sampledDepth + epsilon;
        this.occlusionById.set(sample.id, occluded);
      }
    } finally {
      this.scene.overrideMaterial = previousOverride;
      this.renderer.setRenderTarget(previousTarget);
      this.renderer.autoClear = previousAutoClear;
    }
  }

  private ensureRenderTarget(width: number, height: number): void {
    const targetWidth = Math.max(16, Math.floor(width * DEPTH_DOWNSAMPLE));
    const targetHeight = Math.max(16, Math.floor(height * DEPTH_DOWNSAMPLE));
    if (this.renderTarget && this.renderTarget.width === targetWidth && this.renderTarget.height === targetHeight) {
      return;
    }
    this.renderTarget?.dispose();
    this.renderTarget = new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
  }
}

function unpackRGBADepth(pixel: Uint8Array): number {
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;
  const a = pixel[3] / 255;
  return r / (256 * 256 * 256) + g / (256 * 256) + b / 256 + a;
}
