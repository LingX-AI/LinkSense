export function createIntersectionObserverMock(initiallyVisible = false) {
  const observers = new Set<Observer>()

  class Observer implements IntersectionObserver {
    readonly root: Element | Document | null
    readonly rootMargin: string
    readonly scrollMargin: string
    readonly thresholds: readonly number[]
    private readonly targets = new Set<Element>()
    private readonly callback: IntersectionObserverCallback

    constructor(
      callback: IntersectionObserverCallback,
      options: IntersectionObserverInit = {}
    ) {
      this.callback = callback
      this.root = options.root ?? null
      this.rootMargin = options.rootMargin ?? "0px"
      this.scrollMargin = options.scrollMargin ?? "0px"
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold ?? 0]
      observers.add(this)
    }

    observe(target: Element): void {
      this.targets.add(target)
      queueMicrotask(() => this.intersect(target, initiallyVisible))
    }

    unobserve(target: Element): void {
      this.targets.delete(target)
    }

    disconnect(): void {
      this.targets.clear()
      observers.delete(this)
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }

    intersect(target: Element, visible: boolean): void {
      if (!this.targets.has(target)) return
      const rect = target.getBoundingClientRect()
      this.callback(
        [
          {
            target,
            isIntersecting: visible,
            intersectionRatio: visible ? 1 : 0,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
            time: 0,
          },
        ],
        this
      )
    }
  }

  return {
    Observer,
    observers,
    intersect(target: Element, visible = true): void {
      for (const observer of [...observers]) {
        observer.intersect(target, visible)
      }
    },
  }
}
