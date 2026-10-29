---
type: fix
scope: repo
section: fixed
---

**The game no longer freezes on the first hit after a new deploy.** Browsers
could keep an old copy of a worker beside the new page; worker URLs now carry
a hash of the build.
