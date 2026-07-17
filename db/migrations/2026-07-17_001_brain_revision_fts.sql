-- Spec 013 Phase 1: indexed full-text search over immutable Brain revisions.
-- The runtime query still joins brain.brain_files so only current live heads
-- are returned. The partial index excludes tombstones and grants no new access.

create index if not exists brain_file_revisions_current_content_fts_idx
  on brain.brain_file_revisions
  using gin (
    to_tsvector(
      'simple',
      coalesce(filename, '') || ' ' || coalesce(content, '')
    )
  )
  where deleted = false;
