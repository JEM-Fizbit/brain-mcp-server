-- Bootstrap the ERS Brain row for the John-only hosted multi-Brain pilot.
--
-- This seed is intentionally data-only. Runtime access is controlled by the
-- MCP registry/OAuth layer, and ERS team access remains out of scope until the
-- ERS-owned infrastructure phase.

insert into brain.brains (
  id,
  type,
  template_used,
  integration_mode,
  metadata
)
values (
  'ers-brain',
  'shared',
  'ers',
  'vertical',
  jsonb_build_object(
    'environment', 'john-only-pilot',
    'content_owner', 'ers',
    'canonical_local_checkout', 'SharePoint/OneDrive 01_ers-brain',
    'local_first', true,
    'team_access', false,
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
