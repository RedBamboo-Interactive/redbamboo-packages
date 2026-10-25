---
"@redbamboo/ui": patch
---

Dock: a closed panel's host no longer covers the panels beneath it. Releasing a panel (closing the entity inspector tabbed over Discussions, for example) left its emptied host inside the group body, absolute and visible, so it took every click and wheel event meant for the panel underneath until the layout changed. The host now leaves the group body at once for the dock's hidden parking element (and is kept for a reopen), groups never re-attach an unregistered panel, and after every commit any host a group does not show is hidden and inert, so only a group's active panel can take pointer events.
