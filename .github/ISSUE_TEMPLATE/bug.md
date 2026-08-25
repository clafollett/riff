---
name: Bug
about: Something does not do what it says
labels: bug
---

**What happened, and what you expected instead.**

**How to reproduce it.** The smallest sequence that shows it.

**Where it was running.** Directly on your machine, or in the container?
That decides whether the staff had a shell, which changes a lot.

```
node --version
```

**Anything from the log.** `npm run desk` prints to stdout; the container's is
`docker compose -f docker/compose.yaml logs factory`.
