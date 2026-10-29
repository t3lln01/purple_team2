---
name: API production paths
description: Path-resolution constraint for the Python production server.
---

The API is a Python package under `artifacts/api-server`. Server modules that load workspace data must resolve paths from `Path(__file__)` rather than the current working directory, because development and production may start in different directories.

**Why:** Uvicorn's `--app-dir` controls import resolution but does not guarantee a particular current working directory.

**How to apply:** Anchor backend paths to `Path(__file__).resolve()` and verify both the managed development workflow and the exact production run command, including the configured health endpoint.