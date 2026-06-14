-- Bootstrap the hosted Brain pilot registry row.
--
-- This seed is intentionally data-only. It does not grant anon/authenticated
-- access, add RLS policies, expose schemas, or create public Storage rules.

insert into brain.brains (
  id,
  type,
  template_used,
  integration_mode,
  metadata
)
values (
  'ai-brain-jem',
  'personal',
  'personal',
  'vertical',
  jsonb_build_object(
    'environment', 'pilot',
    'supabase_org', 'ERSG Prototypes',
    'supabase_project', 'brain-platform-pilot',
    'supabase_project_ref', 'omnwbcdtmtvxasgdmvwr',
    'local_first', true,
    'production_cutover_requires_ers_owned_project', true,
    'security_gate', 'docs/security/hosted-brain-supabase-security-gate.md'
  )
)
on conflict (id) do update
set type = excluded.type,
    template_used = excluded.template_used,
    integration_mode = excluded.integration_mode,
    metadata = brain.brains.metadata || excluded.metadata,
    updated_at = now();
