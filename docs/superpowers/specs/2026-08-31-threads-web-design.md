# Threads Web Connector Design Spec

**Date:** 2026-08-31  
**Status:** Approved and implemented

## Summary

Ship one Tapestry connector (`local.threads.web`) with Cookie Header auth.
Default feed is Following via REST (no `doc_id`). For You uses optional GraphQL
`doc_id`. Delete official Feed, Home beta, and oauth-worker packages.

See `local.threads.web/DESIGN.md` for item model, settings optionality, and Loom
checklist.
