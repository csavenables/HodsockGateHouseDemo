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

  constructor(host: HTMLElement, callbacks: AnnotationOverlayCallbacks) {
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
    this.prevButton.className = 'annotation-nav-btn';
    this.prevButton.textContent = 'Prev';
    this.prevButton.onclick = () => callbacks.onPrev();
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'annotation-nav-btn annotation-nav-btn-close';
    this.closeButton.textContent = 'Close';
    this.closeButton.onclick = () => callbacks.onClose();
    this.nextButton = document.createElement('button');
    this.nextButton.type = 'button';
    this.nextButton.className = 'annotation-nav-btn';
    this.nextButton.textContent = 'Next';
    this.nextButton.onclick = () => callbacks.onNext();
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
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  render(model: AnnotationOverlayModel): void {
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
      element.style.opacity = `${pin.alpha}`;
      element.dataset.clickable = pin.clickable ? 'true' : 'false';
      element.classList.toggle('is-selected', model.selectedId === pin.pin.id);
      element.classList.toggle('is-occluded', pin.occluded);
      element.classList.toggle('hidden', !pin.visible);
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

    const showNav = Boolean(model.selectedId && model.showNav);
    this.nav.classList.toggle('hidden', !showNav);
    this.prevButton.disabled = !model.canPrev;
    this.nextButton.disabled = !model.canNext;
  }

  dispose(): void {
    this.root.remove();
    this.pinElements.clear();
  }
}
