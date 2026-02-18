import * as THREE from 'three';
import { AnnotationPinConfig } from '../config/schema';

export interface ProjectedAnnotationPin {
  pin: AnnotationPinConfig;
  world: THREE.Vector3;
  screenX: number;
  screenY: number;
  ndcDepth: number;
  visible: boolean;
  occluded: boolean;
  alpha: number;
  clickable: boolean;
}

export interface AnnotationOverlayModel {
  pins: ProjectedAnnotationPin[];
  selectedId: string | null;
  showTooltip: boolean;
  showNav: boolean;
  canPrev: boolean;
  canNext: boolean;
}

export interface AnnotationOverlayCallbacks {
  onSelect(id: string): void;
  onPrev(): void;
  onNext(): void;
  onClose(): void;
}

export interface OcclusionSamplePoint {
  id: string;
  visible: boolean;
  x: number;
  y: number;
  ndcDepth: number;
}
