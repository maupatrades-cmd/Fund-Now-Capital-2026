# Supabase — database migrations

This folder holds the SQL migrations for the Fund Now Capital CRM database.
They run in filename order:

1. `20260713120000_init_schema.sql` — enums, all 11 tables, indexes, `updated_at` triggers.
2. `20260713120100_commission_engine.sql` — `calculate_commission()` + the server-side recompute trigger on `commission_records`.
3. `20260713120200_rls_policies.sql` — RLS enabled on every table + owner/partner policies.
4. `20260713120300_auth_profile_trigger.sql` — auto-creates a `profiles` row for each new auth user.
5. `20260713120400_seed_reference_data.sql` — seeds the Bright Destiny referral partner (funders pending data).

## Applying

**Option A — Supabase CLI (recommended)**

```bash
supabase link --project-ref hvxruwkgmhjoypepffgv
supabase db push
```

**Option B — SQL editor**

Paste each migration (in order) into the Supabase dashboard SQL editor and run it.

## One-time manual steps (cannot be done in SQL)

1. **Disable public signup** (security rule #4): Dashboard → Authentication → Sign In / Providers → turn **off** "Allow new users to sign up".
2. **Create the first owner**: Dashboard → Authentication → Users → *Add user*. The `handle_new_user` trigger creates their `profiles` row with the default `partner` role, so elevate it once:

   ```sql
   update public.profiles
   set role = 'owner', referral_partner_id = null
   where email = 'YOUR_OWNER_EMAIL';
   ```

## Notes

- All money is `numeric(14,2)`. `commission_records` money columns are recomputed server-side on every insert/update — client values are ignored.
- Partners are **read-only** and only see rows tied to their own `referral_partner_id`. Funder identity (`funders`, `funder_contacts`, `deal_funder_submissions`) is never exposed to partners; a partner-safe view over `display_name_for_partner` will come with the portal.
