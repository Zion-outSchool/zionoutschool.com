# Zion production releases

GitHub `main` is the website source. Netlify serves the public site and portal pages. Supabase runs the database and Edge Functions. A change is live after the components it needs have been verified on production.

## Verify each release

1. Start approved work from current GitHub `main` and publish only the approved files. Keep unrelated work on a development branch. Supabase CLI metadata in `supabase/.temp/` is local. Keep private materials and credentials out of this public repository.
2. For a database or function change, test its migration and permissions on a disposable project first. Apply approved, backward-compatible migrations before releasing website controls that depend on them. Deploy the affected functions and check the authenticated workflow with a fictional record where practical. Record the migration filenames, function version, and result.
3. Confirm the GitHub commit and the **Verify production website** workflow. The check waits for Netlify, compares the portal assets and changed website files with that commit, and tolerates Netlify’s link formatting. The check uses public read-only access. To run it locally against a fetched production branch:
   ```sh
   node scripts/verify-production.mjs --revision origin/main --before origin/main^ --wait 120
   ```
4. For releases that use Supabase, run the read-only database audit and list deployed functions from an authorized Supabase CLI session:
   ```sh
   supabase db query --remote=zwoivkqmnriwtokpbmdo --read-only --file scripts/verify-production.sql
   supabase functions list --remote=zwoivkqmnriwtokpbmdo
   ```
   Use the exact RPC and schema success condition for any new backend feature and add it to the audit. A row marked **missing or pending** needs follow-up before claiming that feature is live. The website workflow verifies Netlify only.
