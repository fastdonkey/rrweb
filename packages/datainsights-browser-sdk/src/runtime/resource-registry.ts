type ResourceDisposer = () => void | Promise<void>;

export class ResourceRegistry {
  private readonly resources = new Set<ResourceDisposer>();

  get count(): number {
    return this.resources.size;
  }

  add(disposer: ResourceDisposer): () => void {
    this.resources.add(disposer);
    return () => this.resources.delete(disposer);
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    target.addEventListener(type, listener, options);
    const disposer = () => target.removeEventListener(type, listener, options);
    this.add(disposer);
    return disposer;
  }

  setTimeout(
    handler: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    const timer = globalThis.setTimeout(handler, delayMs);
    this.add(() => globalThis.clearTimeout(timer));
    return timer;
  }

  setInterval(
    handler: () => void,
    delayMs: number,
  ): ReturnType<typeof setInterval> {
    const timer = globalThis.setInterval(handler, delayMs);
    this.add(() => globalThis.clearInterval(timer));
    return timer;
  }

  async disposeAll(): Promise<{ readonly errors: number }> {
    const disposers = [...this.resources].reverse();
    this.resources.clear();
    let errors = 0;
    for (const dispose of disposers) {
      try {
        await dispose();
      } catch (_error) {
        errors += 1;
      }
    }
    return { errors };
  }
}
