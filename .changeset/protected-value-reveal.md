---
"@redbamboo/ui": minor
---

`ProtectedValueField` can reveal a newly issued value once: pass `revealedValue` (for example the token returned by a rotation) to show it inside the stored-value card with a short one-time notice and a copy action. Focus moves to the value when it appears, a blocked clipboard selects it for manual copy, and `onRevealedValueCopy` reports the copy outcome. The catalog lists the field with its `revealed-value` variant so hosts and plugins can detect the capability.
