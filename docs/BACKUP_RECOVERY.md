# Google Drive Backup and Recovery

## Status

Backup tooling is implemented, but is **not active until merged to main, configured, and verified against production**. No production credentials belong on the developer PC or in `.env.local`. No database migration is required. Google consent and credential setup are operator actions; never send tokens, passwords, signing keys, or the private decryption key through an AI chat.

Workflows: `.github/workflows/google-drive-backup.yml` and `.github/workflows/backup-health.yml`. Standalone Node scripts under `scripts/backup/` do not change app runtime behavior. Production export CLI rejects execution outside GitHub Actions on `main`.

## Schedule and Coverage

| Backup | UTC schedule | Asia/Riyadh | Coverage |
| --- | --- | --- | --- |
| Database | `17 0,6,12,18 * * *` | 03:17, 09:17, 15:17, 21:17 daily | Full accessible PostgreSQL database plus roles without role passwords |
| Full | `47 23 * * *` | 02:47 daily | Database, all Storage buckets/files, Git history/source, recovery configuration |
| Health | `37 */3 * * *` and backup completion | Every 3 hours and completion | Opens/updates a GitHub issue for failures, database overdue >9h or full overdue >30h |

GitHub schedules are best-effort, can be delayed, and run from the default branch. Inactive public repositories can have schedules disabled by GitHub. This is not PITR: intended database recovery-point target is six hours, uploaded files/configuration one day; delays/failures can increase loss. Recovery time is unknown until a real restore drill. The health workflow shares GitHub's availability; an external heartbeat monitor is needed to detect a complete GitHub outage or both workflows being disabled.

The database archive is PostgreSQL custom format, with all accessible non-system schemas including `public`, `auth`, `storage`, and migration history where present. It covers `system_settings` JSON, all sales batches, collections, GPS, orders and Auth records/password hashes. Archive TOC checks require business, Auth users and Storage data. No API-table pagination is used for the database. `postgres:17` provides matching dump/restore tools for server versions up to 17; upgrade this image deliberately if the server becomes newer.

Storage export discovers **all** buckets rather than a fixed allowlist, including `payment-collections`, `customer-documents` and `upload-files`. Listings paginate and recurse. Files stream to disk with SHA256, byte counts, logical object paths, bucket settings and MIME/cache metadata in `storage-manifest.json`. A second listing rejects changes during export. Database and Storage are not a single atomic snapshot; a quiet-period restore point or reconciliation is required for transactions concurrent with the backup.

The full archive also includes a verified `repository.bundle` (`git bundle --all` from the full checkout), `source.tar.gz` of the checked-out production commit, redacted Supabase Auth settings, Vercel project settings, and a Vercel environment-variable inventory (names, types, targets, and branches only). Secrets/passwords/tokens/API keys/SMTP values are redacted or omitted; no environment values are decrypted. `recovery-configuration.json` contains only a password-manager reference and names of recovery secrets. Git archives cover committed source/history, not uncommitted PC edits, GitHub issues/PRs, downloadable APK artifacts, or external Git LFS payloads. Android signing material and provider credentials are deliberately kept out of Drive and must be independently secured in a password manager/offline recovery store.

## Encryption and Retention

Archives are compressed and **age-encrypted before leaving the runner**. Only the public age recipient is needed by the workflow. Keep the private identity in a password manager and a separate offline copy, not in GitHub Actions or this Drive folder. Losing it makes backups unrecoverable. Protect Google and GitHub accounts with MFA and independent recovery codes.

Upload uses `rclone copyto --immutable --checksum`, not `sync`. The job verifies the remote encrypted file's MD5 and size before retention. The encrypted archive also carries internal SHA256 hashes; age authenticates ciphertext. Plaintext temporary files and OAuth config are removed in `finally` on handled success/failure; cancelled runners rely on ephemeral runner disposal. No plaintext GitHub artifact upload is used.

Default destination: `gdrive:MADIBA-SFA-Backups`, private and not shared. OAuth uses **drive.file**, which limits access to files/folders created by this OAuth app. Let rclone create the folder; do not pre-create it in the Drive website. Skip shortcuts. Use only the dedicated remote in the backup config.

Retention cleanup is disabled initially. Once enabled with repository variable `BACKUP_PRUNE_ENABLED=true`, retain seven days of database snapshots (always keep the latest), the newest full backup for 30 distinct KSA days and the newest full backup for 12 distinct KSA months. This count-based policy preserves history across missed runs. Only strictly named job archives are eligible; unrelated files are untouched. Expired files move to Drive Trash, **not permanent deletion**. Trash still uses quota until the operator empties it; do not use `rclone cleanup gdrive:` because that empties all Drive Trash. Drive is not immutable/object-locked and account owners can delete backups.

Google's usual personal free quota is shared across Gmail, Drive and Photos. Daily full copies and Git history may exceed it. Supabase Storage downloads consume its egress allowance; full copies every day may exceed Free limits. Check current plan allowances, first archive size, remaining Drive space and GitHub Actions minutes before enabling ongoing schedules. Increase Drive capacity or adjust retention/full cadence intentionally; never silently drop uploaded files to save space.

## One-Time Google Setup

1. Install official `rclone` and `age` tools on a trusted machine. These are backup tools, not app dependencies.
2. In your Google Cloud project enable **Google Drive API**. Create an OAuth consent app for personal use, with scope `https://www.googleapis.com/auth/drive.file`, and an OAuth client of type **Desktop app**. Use your own client ID/secret; do not rely on rclone's shared OAuth client.
3. Publish the personal consent app to Production before the final authorization. Testing-mode refresh grants can expire in seven days. Personal use may qualify for verification exemptions; follow Google's current requirements and authorize only your own app.
4. Run `rclone config` yourself with a dedicated configuration file outside the repository. Create remote `gdrive`, type `drive`, your OAuth client, scope `drive.file`, browser sign-in with the desired Gmail account, and **no service account or Shared Drive**. The config contains secrets and must not appear in terminal output shared with an agent.
5. Store the complete dedicated config securely as GitHub environment secret `BACKUP_RCLONE_CONFIG`. It must contain exactly one `[gdrive]` section, `type = drive`, `scope = drive.file`, client ID/secret and a `token` JSON with a refresh token. Do not post its contents in chat.
6. Generate an age key with `age-keygen -o <secure-path-outside-repo>`. Save the private file offline/in your password manager. `age-keygen -y <secure-path>` returns the public recipient, which goes in the GitHub variable below. Do not upload the private key to Actions.

## GitHub Configuration

Create environment **production-backup**, restricted to deployments from `main`. Do not configure required reviewers on every scheduled run unless someone will approve each run. Set `BACKUP_ENABLED=true` as a **repository** variable only after setup. This repository-level switch gates both jobs; environment-only variables cannot enable the job-level condition. Never attach these production secrets to PR/test environments.

Repository variables (names and purpose only):

| Variable | Purpose |
| --- | --- |
| `BACKUP_ENABLED` | `true` enables both workflows; unset/false keeps them inactive |
| `BACKUP_SUPABASE_PROJECT_REF` | Explicit 20-letter production project reference |
| `BACKUP_SUPABASE_URL` | Matching production API URL |
| `BACKUP_AGE_RECIPIENT` | Public `age1...` encryption recipient |
| `BACKUP_DRIVE_PATH` | Optional; default `gdrive:MADIBA-SFA-Backups`; one folder only |
| `BACKUP_PRUNE_ENABLED` | Default false; enable only after a successful recovery drill |
| `BACKUP_VERCEL_PROJECT_ID` | Production Vercel project identifier |
| `BACKUP_VERCEL_TEAM_ID` | Optional Vercel team identifier |

Secrets in **production-backup**:

| Secret | Purpose |
| --- | --- |
| `BACKUP_DATABASE_URL` | Supabase **Session pooler** or direct PostgreSQL connection, port 5432, database postgres, percent-encoded password and `sslmode=require`; never transaction pooler port 6543 |
| `BACKUP_SUPABASE_SERVICE_ROLE_KEY` | Read all Storage files through Storage API; powerful key, cloud backup environment only |
| `BACKUP_SUPABASE_ACCESS_TOKEN` | Supabase Management API access for Auth configuration |
| `BACKUP_RCLONE_CONFIG` | Dedicated personal-Drive OAuth configuration |
| `BACKUP_VERCEL_TOKEN` | Scoped access to read project settings and environment-variable metadata only |
| `BACKUP_RECOVERY_INVENTORY_JSON` | JSON inventory containing a password-manager reference and secret names, never secret values |

The inventory JSON format is:

```json
{
	"vaultReference": "Password manager: MADIBA production recovery",
	"secretNames": [
		"ANDROID_KEYSTORE_BASE64",
		"ANDROID_KEYSTORE_PASSWORD",
		"ANDROID_KEY_ALIAS",
		"ANDROID_KEY_PASSWORD",
		"CRON_SECRET",
		"GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"
	]
}
```

Use the names actually configured in the repository; this list is an example, not a claim every secret exists. The backup code rejects additional inventory fields, so do not add any values. GitHub cannot read back saved secret values. Maintain current credentials and Android keystore/passwords in your password manager and an independent encrypted offline copy; on recovery, restore the source and reissue/rotate tokens, service keys, and signing credentials from that vault. Never put raw secret values, the Android keystore, Supabase Vault/pgsodium root key, or age private identity in the Drive archive. Database dumps also do not restore Supabase's platform encryption root key.

GitHub's individual secret-size limit may require splitting an unusually large operator bundle; current implementation expects one JSON secret and refuses incomplete signing fields. Resolve that constraint before activation rather than omitting keys. Authentication tokens for the backup system itself must also be kept in an independent password manager for reconnecting accounts after disaster.

## Activation Checklist

1. Merge the reviewed tooling into `main` through the normal PR/CI process. Local unmerged files are not a running backup service.
2. Configure the environment and all variables/secrets directly in GitHub. Keep repository variable `BACKUP_ENABLED=false` and `BACKUP_PRUNE_ENABLED=false` during setup.
3. Actions > **Google Drive Backup** > Run workflow > `main`, mode `full`, settings-only validation checked. This manual validation is allowed while disabled; it only checks required settings and does not contact Supabase or Drive.
4. After validation passes, set repository variable `BACKUP_ENABLED=true` and run mode `database` with validation unchecked. This makes a real encrypted database archive; if it fails, use the safe stage/category diagnostic and set the switch back to false while investigating.
5. Once database-only succeeds, run mode `full` with validation unchecked to export Storage, Git and configuration as well. If any required export fails, no complete full archive is published. Vercel environment values are intentionally not exported; only safe configuration metadata is archived.
6. Confirm the private Drive folder contains a timestamped `.tar.gz.age` archive and the workflow reports verified upload. Download and decrypt it yourself using the private identity. Run the integrity verifier and a restore drill below.
7. Watch the repository / subscribe to backup alert issues and enable GitHub Actions failure email notifications to your Gmail. Health issues are alerts, not guaranteed direct Gmail delivery without notification settings. Keep GitHub Issues enabled. A missing database snapshot opens an issue after nine hours; missing full snapshot after thirty.
8. Measure backup duration, compressed size, transfer usage and Drive space. Confirm the next scheduled database **and** full runs succeed. Then enable retention cleanup only after approving the retained history and Trash policy.

## Recovery Drill

Use a trusted isolated machine and a new non-production Supabase project or local Supabase stack. Never put restored production credentials into this repository's local/dev environment. Do not run a restore into live production as a test.

1. Download the desired archive from Drive. Decrypt with `age --decrypt --identity <private-key> --output backup.tar.gz <archive.tar.gz.age>`, then inspect/extract it into a secure empty directory. Decryption failure means stop.
2. Run `node scripts/backup/verify-backup.mjs <extracted-directory>`. It checks database/roles and, for full backups, Git/source/configuration/Storage-manifest hashes and every object's SHA256/size. It never writes to a database. Delete the decrypted recovery files when the drill is over.
3. Rebuild source with `git clone <extracted-directory>/repository.bundle <new-recovery-checkout>`, or inspect `source.tar.gz`. Restore the documented production commit, not an arbitrary newer commit. Install locked dependencies and build. Bundle/source excludes uncommitted local work.
4. Inspect `database-toc.txt` and `pg_restore --list database.dump` with PostgreSQL 17 tools. The archive captures managed Supabase schemas, which must **not** be blindly recreated over a fresh managed project. A DBA selects application schemas/extensions, Auth table data, custom Auth triggers/policies, roles/grants, migration history, sequences, Storage policies/bucket metadata, and publications for the target's platform version. Compare grants/default privileges and RLS; `--no-owner` alone does not make a restore safe. Do not blindly run every SQL script or replay seed/test migrations onto restored data.
5. Restore `auth.users`/identities with original UUIDs before dependent profiles and business rows, using a version-compatible selective database restore. Preserve password hashes; check login in the isolated environment. Reset custom PostgreSQL role passwords (not stored in `roles.sql`) and consider revoking restored sessions. Do not create replacement users with random UUIDs, which breaks profile ownership.
6. Recreate each bucket's privacy, size/MIME limits and policies from the manifest/database. Upload each archived object through Supabase Storage API using its manifest bucket/path, content type and cache-control; verify hashes/counts. Do not merely insert `storage.objects` metadata: that does not restore file bytes. Reconcile paths/ownership with the DB metadata. No automated production-write restore command is included.
7. Recreate Vercel settings, environment variable names/targets, stable domains, Supabase Auth redirects/providers, Firebase configuration and Android signing from source plus the separate password-manager/offline vault. Values are intentionally absent from the archive: reissue or rotate credentials and restore signing material from that vault. Substitute target-specific keys/URLs before deploying; do not point a test checkout at live production. Re-enable cron schedules only after validation.
8. Verify row counts, important `system_settings` keys, active sales batch, customer hierarchy/access, FIFO settlement, orders, collections, GPS/attendance, Auth login, file access and an app build. Compare sample totals against a saved pre-drill report. Pending unsynced phone transactions are not in server backups; preserve phones and reconcile their queues separately.
9. Record date, archive identifier, checks, actual recovery time and remaining gaps in a private operator recovery log. Repeat quarterly and after significant schema/configuration changes. Only a successful real drill proves recoverability; unit tests and readable dumps do not.

## Validation Commands

Configuration preflight reports only a fixed allowlist of safe validation messages, such as a missing setting or a pooler URL that does not match the required project/port/TLS format. Database failures are labelled by stage: database archive (`pg_dump`), roles export (`pg_dumpall`), archive validation (`pg_restore`), archive inventory, and dump/roles checksums. Finalization labels manifest writing, archive compression, age encryption, Google Drive upload, and remote upload verification. Known command and local-file errors map to fixed safe categories, including authentication, tool/server version mismatch, permissions, read-only guard, DNS/network availability, pooler user, runner disk space, runner file ownership, and missing expected dump files. Archive coverage failures report only whether business table data, Supabase Auth users, or Storage metadata sections are missing; the archive table listing is never printed. An incomplete archive is never uploaded. Raw stderr, credentials, hosts, file paths, and database object names are never emitted. An unclassified failure still stops without publishing a partial backup. Do not reset passwords or silently exclude schemas based on a generic failure. Runtime tests cover synthetic credential suppression, preflight messages, command and local-file failure categories, stage diagnostics, and archive-coverage failures.

`node --test tests/backupPolicy.test.mjs tests/backupRuntime.test.mjs` covers target/TLS guards, OAuth policy, pagination, retention, full export sequence, failure cleanup, upload verification and tamper detection using synthetic fixtures. With `age`/`age-keygen` installed, set `BACKUP_TOOL_TESTS=true` and run `node --test tests/backupTools.test.mjs` for real encryption/decryption/corruption checks. Workflow syntax can be checked with `actionlint` against both backup workflows. These checks do not contact production or claim a live restore.