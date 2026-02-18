export class AnnotationAuthoring {
  constructor(private readonly enabled: boolean) {}

  bind(): void {
    if (!this.enabled) {
      return;
    }
    // Intentionally left minimal for MVP. Hook for ?author=1 workflows.
  }

  dispose(): void {
    // No-op for MVP authoring helper.
  }
}
