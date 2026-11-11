---
"@redbamboo/ui": minor
"@redbamboo/utility": patch
---

Toasts have one entry point and one stack per document. `toast()`, `updateToast()` and `dismissToast()` feed a single page-wide queue (the package is an import-map singleton), callable from anywhere including outside React; `useToast()` is a thin binding that addresses the document it renders in, so a detached window such as Float Nova gets its own toasts. One `<Toaster />` per document renders them, portalled to the document's portal container so a plugin's CSS scope can no longer move it; a second Toaster for the same document stays empty. `ToastProvider` is deprecated and renders only its children, so existing plugin bundles stop drawing their own overlapping stacks. The utility `AppShell` mounts the page's Toaster.

Toasts now arrive with a slide and fade while their slot grows, so the stack glides up, and leave the same way before their slot collapses; reduced motion keeps only a fade. Hovering the stack holds every timeout. At most five toasts show per document (a loading toast is never pushed out), and a `group` key (e.g. the source plugin) shows three toasts at once and folds the rest into one "+N more" toast that keeps counting. Errors are announced with `role="alert"` and the dismiss button has an accessible name.
