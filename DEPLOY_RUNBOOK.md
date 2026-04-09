# PentaBlocks Deploy Runbook

## Purpose

This runbook defines a safe web deployment flow for PentaBlocks with rollback and backup steps.

## Environment Baseline

- VPS: Ubuntu LTS
- Web server: Nginx
- App runtime: Node.js (for API and static serving flow if needed)
- Database: PostgreSQL (if backend is enabled)
- TLS: Let's Encrypt

## Pre-Deploy Checklist

1. Pull latest code and verify branch/tag.
2. Run `npm install`.
3. Run `npm run lint`.
4. Run `npm run build`.
5. Confirm required env values:
   - `VITE_SITE_URL`
   - `VITE_ANALYTICS_ENDPOINT` (optional)
   - `VITE_ERROR_REPORT_ENDPOINT` (optional)
6. Verify privacy/legal pages exist:
   - `/privacy.html`
   - `/terms.html`

## Release Procedure

1. Build artifact:
   - `npm run build`
2. Copy deploy artifact (`dist/`) to versioned release folder:
   - `/var/www/pentablocks/releases/<timestamp>/`
3. Update current symlink:
   - `/var/www/pentablocks/current -> /var/www/pentablocks/releases/<timestamp>/`
4. Reload Nginx:
   - `sudo nginx -t`
   - `sudo systemctl reload nginx`
5. Smoke checks:
   - load homepage
   - play and complete one level
   - verify retry and solution flow
   - open `/privacy.html` and `/terms.html`

## Backup Procedure

### Static Site Backup

- Keep at least last 5 release folders in `/var/www/pentablocks/releases/`.
- Keep `current` symlink target recorded in deployment log.

### Database Backup (when backend is live)

- Daily `pg_dump` backup:
  - `/var/backups/pentablocks/db_<date>.sql.gz`
- Retention policy:
  - 7 daily
  - 4 weekly
  - 3 monthly

## Rollback Procedure

1. Identify previous healthy release folder.
2. Point `current` symlink to previous release.
3. Reload Nginx.
4. Re-run smoke checks.
5. Log rollback reason and incident notes.

## Failure Scenarios

### Broken Frontend Release

- Symptoms:
  - blank page
  - JS runtime failures
  - broken game loop
- Action:
  - immediate rollback to previous release
  - inspect browser error telemetry

### Backend/API Errors

- Symptoms:
  - analytics endpoint failures
  - auth failures
  - score sync errors
- Action:
  - isolate backend deploy from frontend deploy
  - rollback API service first if needed

### Database Incident

- Symptoms:
  - data corruption
  - failed migrations
- Action:
  - stop write traffic
  - restore from latest valid backup
  - replay minimal safe delta if available

## Post-Deploy Monitoring

- Check web error event volume for first 30 minutes.
- Check analytics event flow:
  - session start
  - level start
  - level complete
  - level fail
- Check user funnel:
  - menu -> level select -> game

## Notes

- First session should remain ad-free by policy.
- Ad pacing target after first session: one break every 3 completed levels.
- Avoid release-time monetization experiments without baseline analytics.
