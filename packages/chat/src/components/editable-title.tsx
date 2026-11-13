import { useEffect, useRef, useState } from "react"

export interface EditableTitleProps {
  title: string
  onRename: (title: string) => void
  /** Controlled editing state, so a menu item or a shortcut can start the rename. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  /** Accessible name of the input, e.g. "Discussion title". */
  inputLabel?: string
  /** Tooltip of the title button, e.g. "Rename discussion". */
  buttonTitle?: string
  /** Form field name of the input. */
  name?: string
}

/** A conversation title that turns into an inline input on click. Enter/blur saves, Escape cancels. */
export function EditableTitle({
  title,
  onRename,
  editing: controlledEditing,
  onEditingChange,
  inputLabel = "Title",
  buttonTitle = "Rename",
  name = "conversation-title",
}: EditableTitleProps) {
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false)
  const editing = controlledEditing ?? uncontrolledEditing
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const setEditing = (nextEditing: boolean) => {
    if (controlledEditing === undefined) setUncontrolledEditing(nextEditing)
    onEditingChange?.(nextEditing)
  }

  useEffect(() => {
    setValue(title)
  }, [title])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    const next = value.trim()
    if (next && next !== title) onRename(next)
    else setValue(title)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        name={name}
        autoComplete="off"
        enterKeyHint="done"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setValue(title)
            setEditing(false)
          }
        }}
        data-slot="editable-title"
        data-editing=""
        className="flex-1 min-w-0 bg-transparent text-[14px] font-medium text-contrast outline-none border-b border-border-a50"
        aria-label={inputLabel}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      data-slot="editable-title"
      className="flex-1 min-w-0 flex items-center gap-2 text-left group/title"
      title={buttonTitle}
    >
      <span className="text-[14px] font-medium text-contrast truncate">{title}</span>
      <i className="ph-bold ph-pen text-[10px] text-text-muted opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}
