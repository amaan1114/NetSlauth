---
name: Scrollable table boundaries
description: Hidden positioned labels can escape a table's local scroll container on mobile.
---

An overflowing table can have a working local scrollbar and still enlarge the
document's horizontal scroll area when an absolutely positioned descendant's
containing block is outside the scroll wrapper.

**Why:** an accessibility-only label in the last wide column escaped the local
scroll boundary. Reducing grid minimums alone did not solve the document
overflow. Keeping positioned content within the wrapper, or using a visible
header instead, resolved the large overflow; the narrow topbar separately
needed shrinkable selectors.

**How to apply:** diagnose positioned descendants as well as table widths.
Verify document `scrollWidth === clientWidth` at narrow widths while retaining
usable local table scrolling; hiding document overflow is not a fix.
