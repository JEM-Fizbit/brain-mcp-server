-- Spec 023: deployment-owned retired-intake fence. No tenant is activated here.
-- Apply with the database owner, then register each approved Brain separately.
begin;
create table if not exists brain.write_policies (
  brain_id text primary key references brain.brains(id),
  version integer not null check (version=1),
  intake text not null check (intake in ('retired','brain_scoped','legacy')),
  task_paths text[] not null default array['TASKS.md'],
  updated_at timestamptz not null default now()
);
alter table brain.write_policies enable row level security;
revoke all on brain.write_policies from public, anon, authenticated, brain_runtime;
grant select on brain.write_policies to brain_runtime;
drop policy if exists brain_runtime_read_write_policies on brain.write_policies;
create policy brain_runtime_read_write_policies on brain.write_policies for select to brain_runtime using (true);

create or replace function brain.active_queue_blocks(body text)
returns setof text language sql immutable set search_path=pg_catalog as $$
  select block from (
    select btrim(regexp_replace(part, '^[ \t]*(#{1,6}[ \t].*|---[ \t]*)$', '', 'gn')) as block
    from regexp_split_to_table(regexp_replace(replace(coalesce(body,''),chr(13),''),chr(10)||'(?=[ \t]*[-*+][ \t]+(?!(Source:|Route hint:|Urgency:|Details:|Routing receipt:)))',chr(10)||chr(10),'gi'), E'\n[ \t]*\n') as part
  ) parts where block<>'' and block !~* '^([-*+][ \t]*)?(\[[x]\]|Transferred\M|Filed\M|Closed\M|Historical\M)'
$$;

create or replace function brain.enforce_retired_queue()
returns trigger language plpgsql security definer set search_path=pg_catalog,brain as $$
declare
  selected_brain text; selected_filename text;
  next_body text; previous_body text;
  target_brain text; target_filename text;
  policy brain.write_policies%rowtype;
begin
  selected_brain:=new.brain_id;
  selected_filename:=lower(normalize(replace(new.filename,chr(92),'/'),NFKC));
  if tg_table_name='brain_files' then
    if new.current_revision_id is null then return new; end if;
    select brain_id,filename,case when deleted then '' else content end
      into target_brain,target_filename,next_body
      from brain.brain_file_revisions where id=new.current_revision_id;
    if target_brain is distinct from new.brain_id or target_filename is distinct from new.filename then
      raise exception using errcode='23514',message='revision_head_identity_mismatch';
    end if;
    if tg_op='UPDATE' and old.current_revision_id is not null then
      select case when deleted then '' else content end into previous_body
        from brain.brain_file_revisions where id=old.current_revision_id;
    end if;
  else
    next_body:=case when new.deleted then '' else new.content end;
    select case when r.deleted then '' else r.content end into previous_body
      from brain.brain_files f join brain.brain_file_revisions r on r.id=f.current_revision_id
      where f.brain_id=new.brain_id and f.filename=new.filename;
  end if;
  select * into policy from brain.write_policies where brain_id=selected_brain;
  if not found or policy.intake<>'retired' then return new; end if;
  if not exists(select 1 from unnest(policy.task_paths) p where lower(normalize(replace(p,chr(92),'/'),NFKC))=selected_filename)
    then return new; end if;
  if exists(
    select * from brain.active_queue_blocks(next_body)
    except all select * from brain.active_queue_blocks(previous_body)
  ) then
    raise exception using errcode='23514',message='general_intake_retired',
      hint='Use the selected Brain Capture or project home. No new Brain intake was saved.';
  end if;
  return new;
end $$;
revoke all on function brain.active_queue_blocks(text) from public, anon, authenticated;
revoke all on function brain.enforce_retired_queue() from public, anon, authenticated;
grant execute on function brain.active_queue_blocks(text) to brain_runtime;

drop trigger if exists retired_queue_revision_fence on brain.brain_file_revisions;
create trigger retired_queue_revision_fence before insert or update of content,deleted,brain_id,filename
on brain.brain_file_revisions for each row execute function brain.enforce_retired_queue();
drop trigger if exists retired_queue_head_fence on brain.brain_files;
create trigger retired_queue_head_fence before insert or update of current_revision_id,brain_id,filename
on brain.brain_files for each row execute function brain.enforce_retired_queue();

-- Retain successful automatic-operation identities across crashes and retries.
create unique index if not exists brain_revision_write_operation_unique
on brain.brain_file_revisions (brain_id,(metadata->'writeContext'->>'operation_id'))
where metadata->'writeContext'->>'request_hash' is not null;
comment on table brain.write_policies is 'Deployment-owned queue fence. Runtime has SELECT only; semantic source interpretation stays with agents.';
commit;
