export interface UiComponentDescriptor {
  id: string
  packageName: string
  exports: readonly string[]
  description: string
  tags: readonly string[]
  useWhen: readonly string[]
  avoidWhen: readonly string[]
  variants: readonly string[]
  selectors: readonly string[]
}

export const UI_COMPONENT_CATALOG: readonly UiComponentDescriptor[] = [
  {
    id: "entity-card",
    packageName: "@redbamboo/ui",
    exports: ["EntityCard", "EntityIdentity", "queryEntityCards"],
    description: "Canonical compact presentation and interaction surface for a RedBamboo entity identity.",
    tags: ["entity", "reference", "identity", "avatar", "link", "selection", "ai-native"],
    useWhen: [
      "Showing an entity reference in a list, form, picker, modal, or provenance surface.",
      "A browser agent needs stable entity identity and navigation metadata in the DOM.",
      "A custom rich card needs the shared entity identity anatomy without the compact card surface.",
    ],
    avoidWhen: [
      "Rendering a generic non-entity card.",
      "Rendering a rich workspace tile or document preview whose outer layout has different semantics; compose EntityIdentity instead.",
      "Fetching, parsing, or resolving RedLeaf entity data inside the design system.",
    ],
    variants: ["row", "outlined"],
    selectors: [
      '[data-slot="entity-card"]',
      '[data-slot="entity-card-primary"]',
      '[data-slot="entity-identity"]',
      '[data-slot="entity-media"]',
      '[data-slot="entity-name"]',
      '[data-slot="entity-details"]',
      '[data-slot="entity-trailing"]',
      '[data-slot="entity-actions"]',
    ],
  },
  {
    id: "floating-surface",
    packageName: "@redbamboo/utility",
    exports: ["registerUiSurface", "useUiSurface", "runUiSurfaceAction"],
    description: "Machine-readable lifecycle and action contract for a browser-local secondary UI surface such as Document Picture-in-Picture.",
    tags: ["surface", "floating", "picture-in-picture", "always-on-top", "ai-native", "multi-window"],
    useWhen: [
      "A plugin exposes a browser-local secondary window whose support and lifecycle must be queryable.",
      "A browser agent needs a stable semantic trigger plus structured action results.",
    ],
    avoidWhen: [
      "The UI is an ordinary dialog or popover inside the current document.",
      "The desired behavior requires a native transparent or click-through operating-system overlay.",
    ],
    variants: ["document-picture-in-picture"],
    selectors: [
      '[data-slot="floating-surface-trigger"]',
      '[data-slot="floating-surface-root"]',
      '[data-ui-surface]',
      '[data-ui-action]',
    ],
  },
]

/** Search the machine-readable design-system catalog by purpose, tag, or export name. */
export function findUiComponents(query: string): UiComponentDescriptor[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...UI_COMPONENT_CATALOG]
  return UI_COMPONENT_CATALOG.filter((component) => {
    const text = [
      component.id,
      component.packageName,
      component.description,
      ...component.exports,
      ...component.tags,
      ...component.useWhen,
      ...component.avoidWhen,
      ...component.variants,
    ].join(" ").toLowerCase()
    return text.includes(normalized)
  })
}
