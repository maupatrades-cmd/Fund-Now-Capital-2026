-- B3.2 Document verification — part 3 of 3: FK index + validate.
--
-- Isolated + non-transactional: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block. Builds the index for the verified_by FK added NOT VALID in
-- part 2, then validates the constraint (a brief SHARE UPDATE EXCLUSIVE scan,
-- not the write-blocking lock a NOT-NULL-from-inline FK would take). House
-- pattern for every FK-on-populated-table migration (CLAUDE.md).

create index concurrently if not exists documents_verified_by_idx
  on public.documents (verified_by);

alter table public.documents validate constraint documents_verified_by_fkey;
