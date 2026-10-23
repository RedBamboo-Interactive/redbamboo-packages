// A small colour dot beside a colour value written as inline code, as GitHub
// shows in issues. Only an inline code span whose whole content is a hex,
// rgb() or hsl() colour qualifies; fenced blocks, links and prose do not.
//
// The value reaches a style attribute, so it must pass a strict parser first.
// Every accepted token is a number, percentage or angle, so text such as
// `red; background:url(x)` can never get through.

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`
const NUMBER_TOKEN = new RegExp(`^${NUMBER}$`, "i")
const PERCENT_TOKEN = new RegExp(`^${NUMBER}%$`, "i")
const HUE_TOKEN = new RegExp(`^${NUMBER}(?:deg|grad|rad|turn)?$`, "i")
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR_FUNCTION = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i
const MAX_LENGTH = 64

const isNumber = (token: string) => NUMBER_TOKEN.test(token)
const isPercent = (token: string) => PERCENT_TOKEN.test(token)
const isNumberOrPercent = (token: string) => isNumber(token) || isPercent(token)

function isLegacyArguments(rgb: boolean, args: string[]): boolean {
  if (args.length !== 3 && args.length !== 4) return false
  const [first, second, third, alpha] = args
  const channelsValid = rgb
    ? [first, second, third].every(isNumber) || [first, second, third].every(isPercent)
    : HUE_TOKEN.test(first) && isPercent(second) && isPercent(third)
  return channelsValid && (alpha === undefined || isNumberOrPercent(alpha))
}

function isModernArguments(rgb: boolean, body: string): boolean {
  const [channelText, alpha, ...rest] = body.split("/").map(part => part.trim())
  if (rest.length > 0 || alpha === "") return false
  const channels = channelText.split(/\s+/)
  if (channels.length !== 3) return false
  const [first, second, third] = channels
  const channelsValid = rgb
    ? channels.every(isNumberOrPercent)
    : HUE_TOKEN.test(first) && isNumberOrPercent(second) && isNumberOrPercent(third)
  return channelsValid && (alpha === undefined || isNumberOrPercent(alpha))
}

/** True for #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb()/rgba() and hsl()/hsla(), legacy or modern syntax. */
export function isColorLiteral(value: string): boolean {
  if (value.length > MAX_LENGTH) return false
  if (HEX_COLOR.test(value)) return true
  const match = COLOR_FUNCTION.exec(value)
  if (!match) return false
  const rgb = match[1].toLowerCase().startsWith("rgb")
  const body = match[2]
  return body.includes(",")
    ? !body.includes("/") && isLegacyArguments(rgb, body.split(",").map(arg => arg.trim()))
    : isModernArguments(rgb, body)
}

/** The colour to paint for an inline code span's text, or null when it is not one. */
export function colorSwatchValue(text: string): string | null {
  const value = text.trim()
  if (!isColorLiteral(value)) return null
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS
  if (typeof css?.supports === "function" && !css.supports("color", value)) return null
  return value
}

function addSwatch(code: HastNode): void {
  const [only, ...rest] = code.children ?? []
  if (!only || rest.length > 0 || only.type !== "text") return
  const color = colorSwatchValue(only.value ?? "")
  if (!color) return
  code.children = [only, {
    type: "element",
    tagName: "span",
    properties: { dataSlot: "color-swatch", ariaHidden: "true", style: `background-color: ${color}` },
    children: [],
  }]
}

function visit(node: HastNode): void {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue
    // Fenced blocks belong to rehype-highlight, and links render as pills.
    if (child.tagName === "pre" || child.tagName === "a") continue
    if (child.tagName === "code") addSwatch(child)
    else visit(child)
  }
}

/** Rehype plugin: a decorative colour swatch inside inline code that holds only a colour. */
export function rehypeColorSwatches() {
  return (tree: HastNode) => visit(tree)
}
