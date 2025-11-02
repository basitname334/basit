# Database Persistence - Deployment Guide

## Problem Solved
Previously, the database was resetting on every deployment because SQLite files in the project directory are lost when containers redeploy. This has been fixed by:

1. **Persistent Storage**: Database now uses persistent disk storage on Render
2. **Environment Detection**: Automatically detects deployment environment and uses appropriate storage path
3. **Migration Improvements**: Prevents creating "Default Customer" on fresh deployments

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

After deployment, check the logs to verify the database path:
```
[Database] Initializing SQLite database at: /tmp/data/data.sqlite
Using SQLite at: /tmp/data/data.sqlite
```

## Troubleshooting

### Database Still Resets
1. Check that persistent disk is mounted in Render dashboard
2. Verify the path in logs matches your persistent disk mount path
3. Ensure `SQLITE_PATH` env var is set if using custom location

### "Default Customer" Appears
This should no longer happen on fresh deployments. If it does:
- Check migration logic in `src/sqlite.js` (lines 135-187)
- Verify the database is actually persisting (check file size in logs)

## Migration Notes

The migration logic has been improved to:
- Only create "Default Customer" when migrating existing orders
- Not create default customer on fresh database deployments
- Preserve existing customer data during migrations

