---
"@redbamboo/ui": minor
---

`RunOnChoice`: the "Run on" node choice for a job, a session or a discussion. It reads `GET /compute/nodes` as the signed-in person (same origin, the kernel's cookie, never a bearer; `loadNodes` overrides the source). With one node that can run the work it is a read-only "Runs on <name>" row with a tooltip pointing at Compute › Nodes, never a dropdown; from two up it is a picker with "Automatic (<node it resolves to>)" first, then the nodes that can run it, then offline, ineligible, unconfirmed and revoked nodes, and nodes without the given `capability` ("No <name> here"), disabled with their reason. `value` null is Automatic, so a caller sends `placement: {nodeId}` only for a picked node. A chosen node that can no longer run the work stays listed, disabled, rather than being dropped. The rules are exported on their own (`runOnView`, `runOnUnavailableReason`, `parseRunOnNodes`) and the component is in the catalog as `run-on-choice`.
