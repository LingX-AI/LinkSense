/** Every source message must have an explicitly authored translation. */
export type TranslationResource<T> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? TranslationResource<T[K]>
        : T[K]
}
