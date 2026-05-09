# @redbamboo/ui

RedBamboo design system — tokens, Tailwind theme, and components.

## Installation

```bash
pnpm add @redbamboo/ui radix-ui lucide-react
```

## Setup

### 1. Import tokens in your entry CSS

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@redbamboo/ui/tokens.css";
@import "@fontsource-variable/geist";
```

### 2. Add package to Tailwind content

In your `tailwind.config.ts` (v3) or ensure your Vite config scans the package:

```typescript
// vite.config.ts — Tailwind v4 auto-detects imports, no extra config needed
```

For Tailwind v4, the `@theme inline` block in `tokens.css` registers all design tokens automatically.

### 3. Use components

```tsx
import { Button, Card, CardHeader, CardContent } from '@redbamboo/ui'

function App() {
  return (
    <Card>
      <CardHeader>Hello</CardHeader>
      <CardContent>
        <Button variant="default">Click me</Button>
      </CardContent>
    </Card>
  )
}
```

## Components

- **Button** — multi-variant, multi-size with CVA
- **Card** — composite (Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter)
- **Badge** — semantic indicator with 6 variants
- **Input** — text input with validation states
- **Label** — accessible form label
- **Tabs** — horizontal/vertical with line and default variants
- **Select** — dropdown with scroll, groups, keyboard navigation
- **Separator** — horizontal/vertical divider
- **Switch** — toggle with sm/default sizes
- **Slider** — range input with track/thumb
- **Popover** — floating content panel
- **DropdownMenu** — full menu system with checkboxes, radio, sub-menus
- **Collapsible** — expandable content
- **Table** — data table with header, body, footer
- **Modal** — overlay dialog with header, sections, footer

## Design tokens

The gold accent dark theme is defined in `tokens.css` using oklch colors:

- **Primary**: `oklch(0.75 0.16 70)` — golden yellow
- **Background**: `oklch(0.27 0.005 260)` — dark blue-grey
- **Foreground**: `oklch(0.82 0 0)` — light grey
- **Font**: Geist Variable

## License

MIT
