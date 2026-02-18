import * as THREE from 'three';
import {
  AnnotationEditorState,
  AnnotationManager,
  AnnotationUpdatePatch,
} from '../annotations/AnnotationManager';
import { AnnotationPersistence } from '../annotations/AnnotationPersistence';
import { InteriorViewConfig, SceneConfig } from '../config/schema';
import { GaussianSplatRenderer } from '../renderers/GaussianSplatRenderer';
import { InputBindings } from './InputBindings';
import { CameraController } from './CameraController';
import { SceneManager, SplatToggleItem } from './SceneManager';

export interface ViewerUi {
  setLoading(loading: boolean, message?: string): void;
  setError(title: string, details: string[]): void;
  clearError(): void;
  configureToolbar(config: SceneConfig): void;
  configureInteriorDebug(
    config: InteriorViewConfig,
    onChange: (patch: Partial<InteriorViewConfig>) => void,
  ): void;
  setSceneTitle(title: string): void;
  setSplatOptions(items: SplatToggleItem[], onSelect: (id: string) => void): void;
  configureAnnotationEditor(handlers: {
    onToggleEdit(enabled: boolean): void;
    onSelectPin(id: string): void;
    onAddPin(): void;
    onDeleteSelected(): void;
    onUpdateSelected(patch: AnnotationUpdatePatch): void;
    onNudge(axis: 'x' | 'y' | 'z', delta: number): void;
    onSave(): void;
  }): void;
  setAnnotationEditorState(state: AnnotationEditorState): void;
  getOverlayElement(): HTMLElement;
  getCanvasHostElement(): HTMLElement;
  getAnnotationHostElement(): HTMLElement;
}

export class Viewer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  private readonly webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly cameraController: CameraController;
  private readonly splatRenderer = new GaussianSplatRenderer();
  private readonly sceneManager: SceneManager;
  private readonly inputBindings: InputBindings;
  private readonly annotationManager: AnnotationManager;
  private readonly annotationPersistence = new AnnotationPersistence();
  private readonly resizeObserver: ResizeObserver;

  private activeSceneId = '';
  private activeConfig: SceneConfig | null = null;
  private fittedHome: SceneConfig['camera']['home'] | null = null;
  private autoRotate = false;
  private disposed = false;
  private pendingResizeSync = false;
  private queuedSelectionId: string | null = null;
  private processingSelection = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly ui: ViewerUi,
  ) {
    this.webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webglRenderer.setSize(container.clientWidth, container.clientHeight);
    this.webglRenderer.setAnimationLoop(this.onFrame);
    this.webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.webglRenderer.domElement);

    this.cameraController = new CameraController(this.camera, this.webglRenderer.domElement);
    this.sceneManager = new SceneManager(this.splatRenderer, {
      onLoading: (message) => {
        this.ui.setLoading(true, message);
      },
      onReady: (config) => {
        this.ui.configureToolbar(config);
        this.ui.setSceneTitle(config.title);
      },
      onItemsChanged: (items) => {
        const activeItem = items.find((item) => item.active);
        this.annotationManager.setActiveAssetId(activeItem?.id ?? null);
        this.ui.setSplatOptions(items, (id) => {
          this.enqueueSplatSelection(id);
        });
      },
    });

    this.inputBindings = new InputBindings({
      onReset: () => this.resetView(),
      onToggleAutorotate: () => this.toggleAutorotate(),
    });
    this.annotationManager = new AnnotationManager({
      host: this.ui.getAnnotationHostElement(),
      camera: this.camera,
      renderer: this.webglRenderer,
      scene: this.scene,
      cameraController: this.cameraController,
    });
    this.annotationManager.onEditorStateChange((state) => {
      this.ui.setAnnotationEditorState(state);
    });
    this.ui.configureAnnotationEditor({
      onToggleEdit: (enabled) => this.annotationManager.setEditMode(enabled),
      onSelectPin: (id) => this.annotationManager.selectAnnotation(id),
      onAddPin: () => this.annotationManager.addPin(),
      onDeleteSelected: () => this.annotationManager.deleteSelected(),
      onUpdateSelected: (patch) => this.annotationManager.updateSelected(patch),
      onNudge: (axis, delta) => this.annotationManager.nudgeSelected(axis, delta),
      onSave: () => {
        void this.saveAnnotations();
      },
    });

    this.scene.background = new THREE.Color('#0b0e14');
    const ambient = new THREE.AmbientLight('#ffffff', 0.8);
    this.scene.add(ambient);

    this.resizeObserver = new ResizeObserver(() => this.scheduleResizeSync());
    this.resizeObserver.observe(this.container);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('scroll', this.onResize);
  }

  async init(sceneId: string): Promise<void> {
    await this.splatRenderer.initialize({
      scene: this.scene,
      camera: this.camera,
      renderer: this.webglRenderer,
      rootElement: this.container,
    });
    this.inputBindings.bind();
    await this.loadScene(sceneId);
  }

  async loadScene(sceneId: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    try {
      this.annotationManager.clear();
      this.ui.clearError();
      const config = await this.sceneManager.loadScene(sceneId);
      const savedAnnotations = await this.annotationPersistence.load(sceneId);
      const mergedConfig: SceneConfig = savedAnnotations
        ? { ...config, annotations: savedAnnotations }
        : config;
      this.activeConfig = mergedConfig;
      this.applySceneConfig(mergedConfig);
      this.activeSceneId = sceneId;
      const interior = this.sceneManager.getInteriorViewConfig();
      if (interior) {
        this.ui.configureInteriorDebug(interior, (patch) => {
          this.sceneManager.updateInteriorViewConfig(patch);
        });
      }
      this.ui.setLoading(false);
      await this.sceneManager.revealActiveScene();
      this.annotationManager.configure(mergedConfig);
    } catch (error) {
      this.ui.setLoading(false);
      const message = error instanceof Error ? error.message : 'Unknown error while loading scene.';
      const details: string[] =
        typeof error === 'object' &&
        error !== null &&
        'details' in error &&
        Array.isArray((error as { details?: unknown }).details)
          ? ((error as { details: string[] }).details ?? [])
          : [];
      this.ui.setError(message, details);
    }
  }

  resetView(): void {
    const config = this.sceneManager.config;
    if (!config) {
      return;
    }
    this.cameraController.setHomeImmediately(this.fittedHome ?? config.camera.home);
  }

  toggleAutorotate(): boolean {
    const config = this.sceneManager.config;
    if (!config || !config.ui.enableAutorotate) {
      return this.autoRotate;
    }
    this.autoRotate = !this.autoRotate;
    this.cameraController.setAutoRotate(this.autoRotate);
    return this.autoRotate;
  }

  setFullscreen(enabled: boolean): void {
    const target = this.container.parentElement ?? this.container;
    if (enabled) {
      void target.requestFullscreen?.();
      return;
    }
    void document.exitFullscreen();
  }

  isFullscreen(): boolean {
    return document.fullscreenElement !== null;
  }

  getActiveSceneId(): string {
    return this.activeSceneId;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeConfig = null;
    this.fittedHome = null;
    this.inputBindings.dispose();
    this.annotationManager.dispose();
    void this.sceneManager.dispose();
    this.cameraController.dispose();
    this.webglRenderer.dispose();
    this.webglRenderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('scroll', this.onResize);
  }

  private applySceneConfig(config: SceneConfig): void {
    this.cameraController.applyLimits(config.camera.limits, config.ui.enablePan);
    this.fitCameraToContent(config);
    this.autoRotate = config.ui.autorotateDefaultOn && config.ui.enableAutorotate;
    this.cameraController.setAutoRotate(this.autoRotate);
  }

  private enqueueSplatSelection(id: string): void {
    this.queuedSelectionId = id;
    if (this.processingSelection) {
      return;
    }
    this.processingSelection = true;
    void this.processQueuedSelections();
  }

  private async processQueuedSelections(): Promise<void> {
    while (this.queuedSelectionId) {
      const targetId = this.queuedSelectionId;
      this.queuedSelectionId = null;
      try {
        await this.sceneManager.activateSplat(targetId, () => {
          if (this.activeConfig) {
            this.fitCameraToContent(this.activeConfig);
          }
        });
      } catch {
        // no-op: SceneManager emits authoritative item state
      }
    }
    this.processingSelection = false;
  }

  private fitCameraToContent(config: SceneConfig): void {
    const fit = this.splatRenderer.getFitData();
    if (!fit) {
      this.cameraController.setHomeImmediately(config.camera.home);
      this.fittedHome = config.camera.home;
      return;
    }

    const expandedLimits = {
      ...config.camera.limits,
      maxDistance: Math.max(config.camera.limits.maxDistance, fit.radius * 8),
    };
    this.cameraController.applyLimits(expandedLimits, config.ui.enablePan);

    const direction = new THREE.Vector3(...config.camera.home.position).sub(
      new THREE.Vector3(...config.camera.home.target),
    );
    const usedDistance = this.cameraController.frameTarget(
      fit.center,
      fit.size,
      fit.radius,
      config.camera.home.fov,
      expandedLimits,
      direction,
    );

    // Keep enough zoom-out headroom after fitting.
    this.cameraController.applyLimits(
      {
        ...expandedLimits,
        maxDistance: Math.max(expandedLimits.maxDistance, usedDistance * 2.5),
      },
      config.ui.enablePan,
    );
    this.fittedHome = this.cameraController.getCurrentHome();
  }

  private onFrame = (): void => {
    const now = performance.now();
    this.cameraController.update(now);
    this.splatRenderer.setInteriorCameraPosition(this.camera.position);
    this.splatRenderer.update();
    this.annotationManager.update(now, this.container.clientWidth, this.container.clientHeight);
    this.splatRenderer.render();
  };

  private onResize = (): void => {
    this.scheduleResizeSync();
  };

  private scheduleResizeSync(): void {
    if (this.pendingResizeSync || this.disposed) {
      return;
    }
    this.pendingResizeSync = true;
    requestAnimationFrame(() => {
      this.pendingResizeSync = false;
      this.syncViewport();
    });
  }

  private syncViewport(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webglRenderer.setSize(width, height);

    if (this.activeConfig) {
      this.fitCameraToContent(this.activeConfig);
    }
  }

  private async saveAnnotations(): Promise<void> {
    if (!this.activeConfig) {
      return;
    }
    const annotations = this.annotationManager.exportAnnotations();
    if (!annotations) {
      return;
    }
    const result = await this.annotationPersistence.save(this.activeSceneId || 'scene', annotations);
    if (result.ok) {
      this.activeConfig = { ...this.activeConfig, annotations };
      return;
    }

    const payload = JSON.stringify({ annotations }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.activeSceneId || 'scene'}-annotations.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    console.warn(`Annotation save fallback used: ${result.reason}`);
  }
}
