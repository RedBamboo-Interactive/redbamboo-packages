import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  isNodeIcon,
  NODE_AUTOMATIC_ICON,
  NODE_COLORS,
  NODE_ICONS,
  nodeColor,
  nodeIconClass,
  nodeIdentity,
  platformNodeIcon,
} from "./components/node-identity.ts"
import { findUiComponents } from "./component-catalog.ts"

test("a node with an icon and a colour from the lists shows them", () => {
  const look = nodeIdentity({ icon: "laptop", color: "teal", os: "windows" })
  assert.equal(look.icon, "laptop")
  assert.equal(look.color?.hex, "#0d9488")
  assert.equal(look.fallback, false)
  assert.equal(nodeIconClass(look.icon), "ph-bold ph-laptop")
})

test("a node without them (an older kernel) shows its platform's logo, neutral", () => {
  assert.deepEqual(nodeIdentity({ os: "windows" }), { icon: "windows-logo", color: null, fallback: true })
  assert.deepEqual(nodeIdentity({ icon: null, color: null, os: "linux" }), { icon: "linux-logo", color: null, fallback: true })
  assert.equal(nodeIdentity({ os: "macos" }).icon, "apple-logo")
  assert.equal(nodeIdentity({}).icon, "desktop-tower")
  assert.equal(platformNodeIcon("Windows"), "windows-logo")
})

test("values outside the lists are treated as absent, never drawn as a class or a colour", () => {
  const look = nodeIdentity({ icon: "x\" onmouseover=\"alert(1)", color: "#ff0000", os: "linux" })
  assert.equal(look.icon, "linux-logo")
  assert.equal(look.color, null)
  assert.equal(isNodeIcon("windows-logo"), false, "a platform logo is a fallback, not a choice")
  assert.equal(nodeColor("neutral"), null)
})

test("the curated lists: about a dozen icons, eight colours, unique, Phosphor names", () => {
  assert.equal(NODE_ICONS.length, 12)
  assert.equal(new Set(NODE_ICONS.map(i => i.name)).size, NODE_ICONS.length)
  assert.ok(NODE_ICONS.every(i => /^[a-z0-9-]+$/.test(i.name) && i.label))
  assert.deepEqual(NODE_COLORS.map(c => c.token), ["blue", "teal", "violet", "amber", "pink", "green", "orange", "red"])
  assert.ok(NODE_COLORS.every(c => /^#[0-9a-f]{6}$/.test(c.hex)))
  assert.ok(!NODE_ICONS.some(i => i.name === NODE_AUTOMATIC_ICON), "Automatic never looks like a node")
})

// WCAG 1.4.11: a meaningful graphic needs 3:1 against what it sits on, in both themes.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test("every node colour reads at 3:1 on light and dark surfaces", () => {
  for (const color of NODE_COLORS)
    for (const surface of ["#ffffff", "#f4f4f5", "#0a0a0a", "#18181b", "#27272a"])
      assert.ok(contrast(color.hex, surface) >= 3, `${color.token} on ${surface}: ${contrast(color.hex, surface).toFixed(2)}`)
})

// The icon font is the shell's (redleaf web), not this package's: point PHOSPHOR_BOLD_CSS at its
// @phosphor-icons/web/src/bold/style.css to check the names.
const phosphorCss = (() => {
  try {
    return process.env.PHOSPHOR_BOLD_CSS ? readFileSync(process.env.PHOSPHOR_BOLD_CSS, "utf8") : null
  } catch {
    return null
  }
})()

test("every curated icon, the platform logos and Automatic's exist in the Phosphor bold set",
  { skip: phosphorCss ? false : "PHOSPHOR_BOLD_CSS is not set" }, () => {
    for (const name of [...NODE_ICONS.map(i => i.name), "windows-logo", "linux-logo", "apple-logo", NODE_AUTOMATIC_ICON])
      assert.ok(phosphorCss.includes(`.ph-bold.ph-${name}:before`), `ph-${name}`)
  })

test("NodeIcon is discoverable in the component catalog", () => {
  assert.equal(findUiComponents("node-icon")[0]?.id, "node-icon")
})
