-- Sales Coordinator uploads client documents (owner, 19 Nov 2026), 1/2: honest provenance for a document an office staff
-- member uploads ("Office" badge). Its own migration so the value is committed before 20261119101000 uses it.
alter type public.document_upload_source add value if not exists 'staff';
