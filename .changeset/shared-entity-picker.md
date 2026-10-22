---
"@redbamboo/ui": minor
---

Add the canonical entity picker: `EntityRefField` and `EntityRefListField`
reference fields plus a searchable `EntityPickerDialog` (single and multiple
selection, inline audio previews), rendered with entity-card rows. Data comes
from a host-provided `EntityPickerSource` through `EntityPickerProvider`, so the
design system never fetches entity data itself. The component catalog now ranks
id and tag matches first, so `picker` finds `entity-picker`.
