# Database Persistence - Deployment Guide

## Problems Solved
Previously, the database was experiencing two main issues:

### Issue 1: Database Reset on Deployment
The database was resetting on every deployment because SQLite files in the project directory are lost when containers redeploy. **Fixed by:**
1. **Persistent Storage**: Database now uses persistent disk storage on Render
2. **Environment Detection**: Automatically detects deployment environment and uses appropriate storage path
3. **Migration Improvements**: Prevents creating "Default Customer" on fresh deployments

### Issue 2: Database Reset Every 2 Hours ⚠️
**Root Cause**: If the persistent disk isn't properly mounted or accessible, the application silently falls back to non-persistent storage (project directory). When Render containers restart (which can happen periodically), all data is lost.

**Fixes Applied**:
1. **Persistent Disk Validation**: The application now tests if the persistent disk is actually writable before using it
2. **Fail-Loud Behavior**: In production, if persistent disk is unavailable, the app will fail to start rather than silently using non-persistent storage
3. **Enhanced Diagnostics**: Added comprehensive logging to track database path, disk status, and file persistence
4. **Health Check Endpoint**: Enhanced `/api/health` endpoint to monitor database status in real-time

## How It Works

### Database Path Priority
The database path is determined in this order:
1. `SQLITE_PATH` environment variable (if set)
2. Persistent disk path (`/tmp/data/data.sqlite`) in production
3. Local development path (`./data.sqlite`) for development

### For Render Deployments

The `render.yaml` file configures a persistent disk:

```yaml
disk:
  name: data-disk
  mountPath: /tmp/data
  sizeGB: 1
```

**Important Steps:**
1. In your Render dashboard, make sure the persistent disk is mounted
2. The database will be stored at `/tmp/data/data.sqlite` and persist across deployments

### For Other Platforms

#### Heroku (Not Recommended for SQLite)
Heroku's filesystem is ephemeral. You need to:
- Use `SQLITE_PATH` env var pointing to external storage (S3, Dropbox, etc.)
- Or switch to PostgreSQL (recommended)

#### Other Platforms
Set the `SQLITE_PATH` environment variable to a persistent location:
```bash
SQLITE_PATH=/path/to/persistent/storage/data.sqlite
```

## Environment Variables

You can configure the database location using:

- `SQLITE_PATH` - Direct path to database file
- `PERSISTENT_DISK_PATH` - Directory for persistent storage (default: `/tmp/data`)
- `NODE_ENV` - Set to `production` for production environments
- `RENDER` - Automatically set on Render platform

## Verification

After deployment, check the logs to verify the database path and persistence:
```
[Database] Initializing SQLite database at: /tmp/data/data.sqlite
[Database] ✓ Persistent disk verified at: /tmp/data
[Database] Directory exists: true
[Database] Directory is writable: ✓
[Database] Environment: production
[Database] Render: true
[Database] Existing database file size: 45.67 KB
[Database] Database file last modified: 2024-01-15T10:30:00.000Z
Using SQLite at: /tmp/data/data.sqlite
```

**Critical**: If you see error messages about persistent disk, your database will reset on container restarts!

### Health Check Monitoring

Use the health endpoint to monitor database status:
```bash
curl https://your-app.onrender.com/api/health
```

Response includes:
- Database path and existence
- Write permissions
- File size and last modified time
- Connection status

### Preventing Service Spin-Down (Render Free Tier)

Render free tier services can spin down after 15 minutes of inactivity. Use an external monitoring service to ping your app:

**Recommended**: Set up [UptimeRobot](https://uptimerobot.com) or similar to ping:
```
https://your-app.onrender.com/api/ping
```
Set interval to 5-10 minutes to keep the service alive.

## Troubleshooting

### Database Resets Every 2 Hours (Critical Issue)
If your database resets periodically (every 2 hours or after container restarts):

1. **Check Application Logs** for these messages:
   - ✅ Good: `[Database] ✓ Persistent disk verified at: /tmp/data`
   - ❌ Bad: `[Database] ERROR: Persistent path /tmp/data is not writable or not persistent!`
   - ❌ Bad: `[Database] FAILING: Cannot use non-persistent storage in production.`

2. **Verify Persistent Disk is Mounted**:
   - Go to Render dashboard → Your Service → Settings → Disks
   - Ensure the disk `data-disk` is listed and shows as "Mounted"
   - If not mounted, click "Mount" and redeploy

3. **Check Health Endpoint**:
   ```bash
   curl https://your-app.onrender.com/api/health
   ```
   Look for `database.writable: false` or errors in the response

4. **Force Persistent Disk Path**:
   If the automatic detection fails, set an environment variable:
   ```bash
   SQLITE_PATH=/tmp/data/data.sqlite
   ```

### Database Still Resets on Deployment
1. Check that persistent disk is mounted in Render dashboard
2. Verify the path in logs matches your persistent disk mount path
3. Ensure `SQLITE_PATH` env var is set if using custom location
4. Check startup logs for the persistent disk verification message

### "Default Customer" Appears
This should no longer happen on fresh deployments. If it does:
- Check migration logic in `src/sqlite.js` (lines 135-187)
- Verify the database is actually persisting (check file size in logs)

## Migration Notes

The migration logic has been improved to:
- Only create "Default Customer" when migrating existing orders
- Not create default customer on fresh database deployments
- Preserve existing customer data during migrations

