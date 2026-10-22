import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import { Button } from "./button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { EntityCard, type EntityCardAction } from "./entity-card"
import { useEntityCardPresentation } from "./entity-presentation"
import {
  entityPickerItemMatches,
  useEntityPickerResolution,
  useEntityPickerSearch,
  type EntityPickerItem,
  type EntityPickerSourceOverride,
} from "./entity-picker-source"
import { entityTypeLabel, pluralizeLabel } from "./entity-picker-core"
import { Icon } from "./icon"
import { Input } from "./input"
import { ScrollArea } from "./scroll-area"
import { cn } from "../utils"

// ── Picker dialog ────────────────────────────────────────────────────────────

interface EntityPickerDialogBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Entity type slug the host searches, for example `agent`. */
  targetType: string
  title?: string
  description?: string
  searchPlaceholder?: string
  /** Singular human name of the type for labels, e.g. "agent". Defaults from `targetType`. */
  typeLabel?: string
  /** Maximum rows requested from the host per search. */
  limit?: number
  /**
   * Per-field source: any subset of `search`, `resolve`, `subscribe`. Missing
   * methods come from the nearest `EntityPickerProvider`.
   */
  source?: EntityPickerSourceOverride | null
}

export interface EntityPickerSingleDialogProps extends EntityPickerDialogBaseProps {
  multiple?: false
  /** Current reference (id or slug), marked as selected. */
  value?: string | null
  /** Called with the entity id. The dialog closes itself. */
  onSelect: (id: string, item: EntityPickerItem) => void
}

export interface EntityPickerMultipleDialogProps extends EntityPickerDialogBaseProps {
  multiple: true
  value: readonly string[]
  /** Called on Done with the chosen references and every item the dialog has seen for them. */
  onSelect: (ids: string[], items: EntityPickerItem[]) => void
}

export type EntityPickerDialogProps = EntityPickerSingleDialogProps | EntityPickerMultipleDialogProps

function asList(value: string | readonly string[] | null | undefined): string[] {
  if (Array.isArray(value)) return [...value]
  return typeof value === "string" && value ? [value] : []
}

/** Inline audio preview shared by every row; one clip plays at a time. */
function useAudioPreview(active: boolean) {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }
    audioRef.current = null
    setPlayingId(null)
  }, [])

  const toggle = useCallback((event: MouseEvent, id: string, url: string) => {
    event.preventDefault()
    event.stopPropagation()
    if (playingId === id) {
      stop()
      return
    }
    stop()
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingId(id)
    const finish = () => {
      if (audioRef.current !== audio) return
      audioRef.current = null
      setPlayingId(null)
    }
    audio.addEventListener("ended", finish, { once: true })
    audio.addEventListener("error", finish, { once: true })
    void audio.play().catch(finish)
  }, [playingId, stop])

  useEffect(() => {
    if (!active) stop()
  }, [active, stop])

  useEffect(() => () => {
    audioRef.current?.pause()
    audioRef.current = null
  }, [])

  return { playingId, toggle }
}

/**
 * Canonical entity picker: search, a list of entity-card rows, single or
 * multiple selection. Data comes from the host's `EntityPickerSource`.
 */
export function EntityPickerDialog(props: EntityPickerDialogProps) {
  const {
    open,
    onOpenChange,
    targetType,
    title,
    description,
    searchPlaceholder = "Search...",
    typeLabel = entityTypeLabel(targetType),
    limit,
    source,
  } = props
  const multiple = props.multiple === true
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<string[]>(() => asList(props.value))
  const seen = useRef(new Map<string, EntityPickerItem>())
  const search = useEntityPickerSearch({ type: targetType, query, limit, enabled: open, source })
  const preview = useAudioPreview(open)

  useEffect(() => {
    // Re-seed only when the dialog opens, so edits survive parent re-renders.
    if (open) setSelected(asList(props.value))
  }, [open])

  useEffect(() => {
    for (const item of search.items) seen.current.set(item.entity.id, item)
  }, [search.items])

  const isSelected = (item: EntityPickerItem) => multiple
    ? selected.some((reference) => entityPickerItemMatches(item, reference))
    : entityPickerItemMatches(item, asList(props.value)[0])

  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery("")
    onOpenChange(next)
  }

  const choose = (item: EntityPickerItem) => {
    if (!props.multiple) {
      props.onSelect(item.entity.id, item)
      handleOpenChange(false)
      return
    }
    setSelected((previous) => previous.some((reference) => entityPickerItemMatches(item, reference))
      ? previous.filter((reference) => !entityPickerItemMatches(item, reference))
      : [...previous, item.entity.id])
  }

  const finish = () => {
    if (!props.multiple) return
    const items = selected.flatMap((reference) => {
      const item = seen.current.get(reference)
        ?? [...seen.current.values()].find((candidate) => entityPickerItemMatches(candidate, reference))
      return item ? [item] : []
    })
    props.onSelect(selected, items)
    handleOpenChange(false)
  }

  const loading = search.status === "loading" && search.items.length === 0
  const resultCount = search.items.length
  const statusText = search.status === "unavailable"
    ? "Entity search is not available here"
    : search.status === "error"
      ? search.error ?? "Could not load entities"
      : loading || search.status === "idle"
        ? "Loading..."
        : search.items.length === 0
          ? (query.trim() ? "No matches" : "No entities found")
          : null
  // Announced politely; silent while a refinement is loading over visible rows.
  const announcement = statusText
    ?? (search.status === "loading" ? "" : `${resultCount} ${resultCount === 1 ? "result" : "results"}`)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        data-entity-picker-type={targetType}
        data-entity-picker-mode={multiple ? "multiple" : "single"}
      >
        <DialogHeader>
          <DialogTitle>{title || `Select ${targetType}`}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="px-1">
          <Input
            data-slot="entity-picker-search"
            placeholder={searchPlaceholder}
            aria-label={`Search ${pluralizeLabel(typeLabel)}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            className="focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        <div data-slot="entity-picker-announcer" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement}
        </div>

        <ScrollArea className="h-[min(32rem,calc(100svh-10rem))] min-h-0 -mx-5 px-5 overscroll-contain">
          {statusText ? (
            <div
              data-slot="entity-picker-status"
              data-status={search.status}
              className="py-8 text-center text-sm text-text-muted"
            >
              {statusText}
            </div>
          ) : (
            <div data-slot="entity-picker-list" aria-busy={search.status === "loading" || undefined} className="space-y-0.5">
              {search.items.map((item) => {
                const chosen = isSelected(item)
                const playing = preview.playingId === item.entity.id
                const label = `${chosen ? "Deselect" : "Select"} ${item.entity.name}`
                const action: EntityCardAction = { kind: "button", onActivate: () => choose(item), ariaLabel: label }
                return (
                  <EntityCard
                    key={item.entity.id}
                    entity={item.entity}
                    visual={item.visual}
                    subtitle={item.subtitle}
                    details={item.details}
                    action={action}
                    selected={chosen}
                    trailing={item.trailing}
                    className="rounded-md py-2"
                    actions={item.previewAudioUrl || multiple ? (
                      <div className="flex items-center gap-1.5">
                        {item.previewAudioUrl && (
                          <button
                            type="button"
                            data-slot="entity-picker-preview"
                            onClick={(event) => preview.toggle(event, item.entity.id, item.previewAudioUrl!)}
                            aria-label={`${playing ? "Stop" : "Play"} ${item.entity.name} preview`}
                            aria-pressed={playing}
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                              playing
                                ? "border-primary bg-primary text-white"
                                : "border-overlay-6 text-text-muted hover:border-primary/40 hover:text-primary",
                            )}
                          >
                            <Icon name={playing ? "ph-bold ph-stop" : "ph-bold ph-play"} className="text-[10px]" aria-hidden="true" />
                          </button>
                        )}
                        {multiple && (
                          <button
                            type="button"
                            data-slot="entity-picker-toggle"
                            onClick={(event) => { event.stopPropagation(); choose(item) }}
                            aria-label={label}
                            aria-pressed={chosen}
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded border transition-colors",
                              chosen ? "border-primary bg-primary text-white" : "border-overlay-6",
                            )}
                          >
                            {chosen && <Icon name="ph-bold ph-check" className="text-[10px]" aria-hidden="true" />}
                          </button>
                        )}
                      </div>
                    ) : undefined}
                  />
                )
              })}
            </div>
          )}
        </ScrollArea>

        {multiple && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button data-slot="entity-picker-done" onClick={finish}>Done ({selected.length})</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Reference fields ─────────────────────────────────────────────────────────

function EntityRefEmpty({ onOpen, disabled, label }: { onOpen: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      data-slot="entity-ref-empty"
      onClick={onOpen}
      disabled={disabled}
      aria-haspopup="dialog"
      className="flex w-full items-center gap-3 rounded-md border border-dashed border-overlay-6 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-overlay-4 disabled:pointer-events-none"
    >
      <Icon name="ph-bold ph-link" className="text-xs text-text-disabled" aria-hidden="true" />
      <span className="text-sm text-text-disabled">{label}</span>
      <Icon name="ph-bold ph-caret-right" className="ml-auto text-[10px] text-text-disabled" aria-hidden="true" />
    </button>
  )
}

function EntityRefClear({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <button
      type="button"
      data-slot="entity-ref-clear"
      onClick={onClear}
      className="text-text-disabled transition-colors hover:text-destructive"
      aria-label={`Clear ${name}`}
    >
      <Icon name="ph-bold ph-x" className="text-xs" aria-hidden="true" />
    </button>
  )
}

/** A chosen entity as an outlined card, hydrated through the host presentation bridge. */
function EntityRefCard({
  item,
  onChange,
  onClear,
}: {
  item: EntityPickerItem
  onChange?: () => void
  onClear?: () => void
}) {
  const presentation = useEntityCardPresentation(item.entity)
  const entity = presentation?.entity ?? item.entity
  const action: EntityCardAction | undefined = item.href
    ? { kind: "inspect", href: item.href, ariaLabel: `Inspect ${entity.name}` }
    : undefined
  return (
    <EntityCard
      entity={entity}
      visual={presentation?.visual ?? item.visual}
      subtitle={presentation?.subtitle ?? item.subtitle}
      variant="outlined"
      className="py-2"
      action={action}
      trailing={item.trailing || action ? (
        <>
          {item.trailing}
          {action && <Icon name="ph-bold ph-caret-right" className="text-[10px] text-text-disabled" aria-hidden="true" />}
        </>
      ) : undefined}
      actions={onChange || onClear ? (
        <>
          {onChange && (
            <button
              type="button"
              data-slot="entity-ref-change"
              onClick={onChange}
              aria-haspopup="dialog"
              aria-label={`Change ${entity.name}`}
              className="text-[10px] text-text-muted transition-colors hover:text-primary"
            >
              Change
            </button>
          )}
          {onClear && <EntityRefClear name={entity.name} onClear={onClear} />}
        </>
      ) : undefined}
    />
  )
}

/** A stored reference the host could not resolve (deleted, inaccessible, or still loading). */
function EntityRefPlaceholder({
  reference,
  status,
  typeLabel,
  onChange,
  onClear,
}: {
  reference: string
  status: "loading" | "missing" | "error"
  typeLabel: string
  onChange?: () => void
  onClear?: () => void
}) {
  const described = status === "missing" ? `unavailable ${typeLabel}` : typeLabel
  return (
    <div
      data-slot="entity-ref-unresolved"
      data-status={status}
      aria-busy={status === "loading" || undefined}
      title={status === "error" ? `Could not load this ${typeLabel}; retrying` : undefined}
      className="flex items-center gap-3 rounded-md border border-overlay-6 bg-overlay-4/50 px-3 py-2"
    >
      <span className={cn("min-w-0 flex-1 truncate font-mono text-xs text-text-muted", status === "loading" && "opacity-60")}>
        {reference}
      </span>
      {onChange && (
        <button
          type="button"
          data-slot="entity-ref-change"
          onClick={onChange}
          aria-haspopup="dialog"
          aria-label={`Change ${described} ${reference}`}
          className="text-[10px] text-text-muted transition-colors hover:text-primary"
        >
          Change
        </button>
      )}
      {onClear && <EntityRefClear name={`${described} ${reference}`} onClear={onClear} />}
    </div>
  )
}

interface EntityRefFieldBaseProps {
  targetType: string
  disabled?: boolean
  /** Picker dialog title. Defaults to `Select <targetType>`. */
  title?: string
  description?: string
  /** Empty-state label. */
  placeholder?: string
  /** Singular human name of the type for labels, e.g. "agent". Defaults from `targetType`. */
  typeLabel?: string
  /**
   * Per-field source: any subset of `search`, `resolve`, `subscribe`. Missing
   * methods come from the nearest `EntityPickerProvider`.
   */
  source?: EntityPickerSourceOverride | null
  className?: string
}

export interface EntityRefFieldProps extends EntityRefFieldBaseProps {
  /** Stored reference: entity id or slug. */
  value: string | null | undefined
  /** Receives the picked entity id, or undefined when cleared. */
  onChange: (value: string | undefined, item?: EntityPickerItem) => void
  /** Already-known projection of `value`, rendered without waiting for the host. */
  initialItem?: EntityPickerItem | null
  /** Show the clear action. Defaults to true. */
  clearable?: boolean
}

/**
 * Canonical single entity-reference field: the chosen entity as an outlined
 * entity card with Change and Clear, or a dashed "None" button that opens the
 * picker.
 */
export function EntityRefField({
  value,
  onChange,
  targetType,
  disabled,
  initialItem,
  clearable = true,
  title,
  description,
  placeholder = "None",
  typeLabel = entityTypeLabel(targetType),
  source,
  className,
}: EntityRefFieldProps) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<EntityPickerItem | null>(null)
  const known = [picked, initialItem].filter((item): item is EntityPickerItem => !!item)
  const references = value ? [value] : []
  const resolution = useEntityPickerResolution({ type: targetType, references, known, source })
  const current = value ? resolution.get(value) : null
  const openPicker = disabled ? undefined : () => setOpen(true)
  const clear = disabled || !clearable ? undefined : () => onChange(undefined)

  return (
    <div data-slot="entity-ref-field" data-entity-ref-type={targetType} data-disabled={disabled || undefined} className={className}>
      {!current ? (
        <EntityRefEmpty onOpen={() => setOpen(true)} disabled={disabled} label={placeholder} />
      ) : current.status === "resolved" ? (
        <EntityRefCard item={current.item} onChange={openPicker} onClear={clear} />
      ) : (
        <EntityRefPlaceholder reference={value!} status={current.status} typeLabel={typeLabel} onChange={openPicker} onClear={clear} />
      )}
      {!disabled && (
        <EntityPickerDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            resolution.retry()
          }}
          targetType={targetType}
          typeLabel={typeLabel}
          title={title}
          description={description}
          source={source}
          value={value ?? null}
          onSelect={(id, item) => {
            setPicked(item)
            onChange(id, item)
          }}
        />
      )}
    </div>
  )
}

export interface EntityRefListFieldProps extends EntityRefFieldBaseProps {
  value: readonly string[]
  onChange: (value: string[], items: EntityPickerItem[]) => void
  initialItems?: readonly EntityPickerItem[]
}

/** Canonical multi-entity reference field built on the same picker and card anatomy. */
export function EntityRefListField({
  value,
  onChange,
  targetType,
  disabled,
  initialItems = [],
  title,
  description,
  placeholder = "None",
  typeLabel = entityTypeLabel(targetType),
  source,
  className,
}: EntityRefListFieldProps) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<EntityPickerItem[]>([])
  const known = [...picked, ...initialItems]
  const resolution = useEntityPickerResolution({ type: targetType, references: value, known, source })
  const resolvedItems = () => value.flatMap((reference) => {
    const current = resolution.get(reference)
    return current.status === "resolved" ? [current.item] : []
  })
  const removeAt = (index: number) => {
    const next = value.filter((_, itemIndex) => itemIndex !== index)
    onChange(next, resolvedItems().filter((item) => next.some((reference) => entityPickerItemMatches(item, reference))))
  }

  return (
    <div data-slot="entity-ref-field" data-entity-ref-type={targetType} data-multiple="" data-disabled={disabled || undefined} className={className}>
      <div className="space-y-1.5">
        {value.length === 0 ? (
          <EntityRefEmpty onOpen={() => setOpen(true)} disabled={disabled} label={placeholder} />
        ) : value.map((reference, index) => {
          const current = resolution.get(reference)
          const clear = disabled ? undefined : () => removeAt(index)
          return current.status === "resolved" ? (
            <EntityRefCard key={`${reference}-${current.item.entity.id}`} item={current.item} onClear={clear} />
          ) : (
            <EntityRefPlaceholder key={`${reference}-${index}`} reference={reference} status={current.status} typeLabel={typeLabel} onClear={clear} />
          )
        })}
        {!disabled && value.length > 0 && (
          <Button variant="outline" size="xs" data-slot="entity-ref-change" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Icon name="ph-bold ph-arrows-clockwise" className="mr-1 text-[9px]" aria-hidden="true" />
            Change selection
          </Button>
        )}
      </div>
      {!disabled && (
        <EntityPickerDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            resolution.retry()
          }}
          targetType={targetType}
          typeLabel={typeLabel}
          title={title}
          description={description}
          source={source}
          multiple
          value={value}
          onSelect={(ids, items) => {
            setPicked((previous) => [...items, ...previous])
            onChange(ids, items)
          }}
        />
      )}
    </div>
  )
}
