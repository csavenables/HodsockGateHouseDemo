import { AnnotationOverlayCallbacks, AnnotationOverlayModel } from './AnnotationTypes';

export class AnnotationOverlay {
  private readonly root: HTMLElement;
  private readonly pinLayer: HTMLElement;
  private readonly tooltip: HTMLElement;
  private readonly tooltipTitle: HTMLElement;
  private readonly tooltipBody: HTMLElement;
  private readonly nav: HTMLElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly pinElements = new Map<string, HTMLButtonElement>();
  private stagedNavStep = 0;
  private firstPinId: string | null = null;
  private fallbackVisiblePinId: string | null = null;

  constructor(host: HTMLElement, callbacks: AnnotationOverlayCallbacks) {
    const chevronLeft =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
    const chevronRight =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
    this.root = document.createElement('div');
    this.root.className = 'annotation-overlay hidden';

    this.pinLayer = document.createElement('div');
    this.pinLayer.className = 'annotation-pins';
    this.root.appendChild(this.pinLayer);

    this.tooltip = document.createElement('aside');
    this.tooltip.className = 'annotation-tooltip hidden';
    this.tooltipTitle = document.createElement('h3');
    this.tooltipTitle.className = 'annotation-tooltip-title';
    this.tooltipBody = document.createElement('p');
    this.tooltipBody.className = 'annotation-tooltip-body';
    this.tooltip.append(this.tooltipTitle, this.tooltipBody);
    this.root.appendChild(this.tooltip);

    this.nav = document.createElement('nav');
    this.nav.className = 'annotation-nav hidden';
    this.prevButton = document.createElement('button');
    this.prevButton.type = 'button';
    this.prevButton.className = 'annotation-nav-btn annotation-nav-btn-icon';
    this.prevButton.innerHTML = chevronLeft;
    this.prevButton.setAttribute('aria-label', 'Previous annotation');
    this.prevButton.onclick = () => callbacks.onPrev();
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'annotation-nav-btn annotation-nav-btn-close';
    this.closeButton.textContent = 'Close';
    this.closeButton.onclick = () => callbacks.onClose();
    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'annotation-nav-btn annotation-nav-btn-icon';
    this.nextButton.innerHTML = chevronRight;
    this.nextButton.setAttribute('aria-label', 'Next annotation');
    this.nextButton.onclick = () => {
      callbacks.onNext();
      if (this.stagedNavStep < 2) {
        this.stagedNavStep = 2;
      }
    };
    this.nav.append(this.prevButton, this.closeButton, this.nextButton);
    this.root.appendChild(this.nav);

    host.appendChild(this.root);

    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const pinButton = target?.closest<HTMLButtonElement>('button.annotation-pin');
      if (!pinButton) {
        return;
      }
      const pinId = pinButton.dataset.pinId;
      if (!pinId || pinButton.dataset.clickable !== 'true') {
        return;
      }
      callbacks.onSelect(pinId);
      if (this.stagedNavStep === 0 && this.firstPinId && pinId === this.firstPinId) {
        this.stagedNavStep = 1;
      }
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.stagedNavStep = 0;
      this.firstPinId = null;
      this.fallbackVisiblePinId = null;
      for (const element of this.pinElements.values()) {
        delete element.dataset.introPlayed;
        element.classList.remove('is-stage-intro');
      }
    }
  }

  render(model: AnnotationOverlayModel): void {
    const orderedPins = [...model.pins].sort((a, b) => a.pin.order - b.pin.order);
    const orderedVisiblePins = orderedPins.filter((pin) => pin.visible);
    const explicitFirst = orderedPins.find((pin) => pin.pin.order === 1);
    this.firstPinId = explicitFirst?.pin.id ?? orderedPins[0]?.pin.id ?? null;
    this.fallbackVisiblePinId = orderedVisiblePins[0]?.pin.id ?? null;

    for (const pin of model.pins) {
      let element = this.pinElements.get(pin.pin.id);
      if (!element) {
        element = document.createElement('button');
        element.type = 'button';
        element.className = 'annotation-pin';
        element.dataset.pinId = pin.pin.id;
        this.pinLayer.appendChild(element);
        this.pinElements.set(pin.pin.id, element);
      }
      element.textContent = String(pin.pin.order);
      element.style.left = `${pin.screenX}px`;
      element.style.top = `${pin.screenY}px`;
      element.dataset.clickable = pin.clickable ? 'true' : 'false';
      element.classList.toggle('is-selected', model.selectedId === pin.pin.id);
      element.classList.toggle('is-occluded', pin.occluded);
      const stageZeroVisibleId = (() => {
        if (!this.firstPinId) {
          return this.fallbackVisiblePinId;
        }
        const firstProjected = model.pins.find((entry) => entry.pin.id === this.firstPinId);
        if (firstProjected?.visible) {
          return this.firstPinId;
        }
        return this.fallbackVisiblePinId;
      })();
      const shouldShowPin = this.stagedNavStep === 0
        ? pin.visible && pin.pin.id === stageZeroVisibleId
        : pin.visible;
      element.classList.toggle('hidden', !shouldShowPin);
      const isStageIntroPin = this.stagedNavStep === 0 && pin.pin.id === stageZeroVisibleId && shouldShowPin;
      if (!isStageIntroPin) {
        delete element.dataset.introPlayed;
      }
      element.classList.toggle('is-stage-intro', isStageIntroPin);
      const targetOpacity = isStageIntroPin ? 1 : pin.alpha;
      if (isStageIntroPin && element.dataset.introPlayed !== 'true') {
        element.dataset.introPlayed = 'true';
        element.style.opacity = '0';
        requestAnimationFrame(() => {
          if (!element.isConnected || element.classList.contains('hidden')) {
            return;
          }
          element.style.opacity = `${targetOpacity}`;
        });
      } else {
        element.style.opacity = `${targetOpacity}`;
      }
      element.disabled = !pin.clickable;
      element.setAttribute('aria-label', `${pin.pin.order}. ${pin.pin.title}`);
    }

    for (const [pinId, element] of this.pinElements) {
      if (!model.pins.some((pin) => pin.pin.id === pinId)) {
        element.remove();
        this.pinElements.delete(pinId);
      }
    }

    const selectedPin = model.pins.find((pin) => pin.pin.id === model.selectedId);
    const showTooltip = Boolean(selectedPin && model.showTooltip && selectedPin.visible);
    this.tooltip.classList.toggle('hidden', !showTooltip);
    if (selectedPin && showTooltip) {
      const width = this.root.clientWidth;
      const height = this.root.clientHeight;
      this.tooltipTitle.textContent = selectedPin.pin.title;
      this.tooltipBody.textContent = selectedPin.pin.body;
      this.tooltip.style.left = `${Math.max(12, Math.min(width - 260, selectedPin.screenX + 18))}px`;
      this.tooltip.style.top = `${Math.max(12, Math.min(height - 120, selectedPin.screenY + 16))}px`;
    }

    const showNav = Boolean(model.showNav && this.stagedNavStep > 0);
    const showPrev = this.stagedNavStep >= 2;
    const showClose = this.stagedNavStep >= 2;
    const showNext = this.stagedNavStep >= 1;
    this.nav.classList.toggle('hidden', !showNav);
    this.nav.dataset.step = String(this.stagedNavStep);
    this.prevButton.classList.toggle('hidden', !showPrev);
    this.closeButton.classList.toggle('hidden', !showClose);
    this.nextButton.classList.toggle('hidden', !showNext);
    this.prevButton.disabled = !showPrev || !model.canPrev;
    this.closeButton.disabled = !showClose || !model.selectedId;
    this.nextButton.disabled = !showNext || !model.canNext;
  }

  dispose(): void {
    this.root.remove();
    this.pinElements.clear();
  }
}
