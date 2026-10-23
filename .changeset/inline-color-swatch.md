---
"@redbamboo/chat": minor
"@redbamboo/ui": patch
---

Show a small colour swatch beside a colour value written as inline code in chat messages, as GitHub does. It applies to assistant text and user bubbles when the whole span is `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()`/`rgba()` or `hsl()`/`hsla()` (legacy or space-separated syntax). Fenced code, bare text and links are left alone. The value must pass a strict parser and `CSS.supports`, and only the swatch's background colour is set. The swatch is decorative (`aria-hidden`, no text), so copied text is unchanged. `@redbamboo/ui` styles it in the Markdown body rules: `[data-slot="color-swatch"]`.
