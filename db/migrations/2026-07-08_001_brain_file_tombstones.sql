-- Spec 011 v2 — brain file delete & rename (tombstone revisions).
-- Additive + safe on the live table (metadata-only column add; NOT NULL drops are fast).
-- A deletion is a normal append-only revision with deleted=true and null content.
-- No RLS/grant change: migration 003 policies are using(true)/with check(true);
-- column additions inherit table-level grants for brain_runtime.
-- Applies to the live personal project (Hard Gate, operator-run) and carries to the
-- future ERS-owned project at infra migration.

alter table brain.brain_file_revisions
  add column if not exists deleted boolean not null default false;

-- Tombstones carry no content; live revisions still must.
alter table brain.brain_file_revisions
  alter column content drop not null;

alter table brain.brain_file_revisions
  alter column content_sha256 drop not null;

-- A live (non-deleted) revision must have content + hash; a tombstone must not need them.
-- Named so it can be dropped/re-added if the model evolves.
alter table brain.brain_file_revisions
  drop constraint if exists brain_file_revisions_content_presence_ck;
alter table brain.brain_file_revisions
  add constraint brain_file_revisions_content_presence_ck
  check (deleted or (content is not null and content_sha256 is not null));

comment on column brain.brain_file_revisions.deleted is
  'Tombstone marker (spec 011). deleted=true rows have null content/content_sha256 and represent a delete; the head pointing at one means the file is absent from read/list/search but recoverable from history.';
