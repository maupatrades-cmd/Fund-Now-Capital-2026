-- Sub-agent (lead_referrer) document uploads: honest provenance for documents a sub-agent attaches to a lead they
-- submitted. Its own migration so the value is committed before 20261116090000 uses it.
alter type public.document_upload_source add value if not exists 'lead_referrer';
