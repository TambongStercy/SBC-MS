# MongoDB Atlas to Local VPS Migration Guide

## Prerequisites
- Ubuntu VPS with sudo access
- MongoDB Atlas connection string
- MongoDB Compass (for alternative migration method)

## Step 1: Install MongoDB on Ubuntu VPS

```bash
# Run the installation script
sudo bash scripts/install-mongodb.sh
```

**Important**: Edit the script to change the default admin password before running!

## Step 2: Configure MongoDB (Optional but Recommended)

```bash
# Edit MongoDB configuration
sudo nano /etc/mongod.conf
```

Add these security settings:
```yaml
security:
  authorization: enabled

net:
  port: 27017
  bindIp: 127.0.0.1  # Only allow local connections
```

Restart MongoDB:
```bash
sudo systemctl restart mongod
```

## Step 3: Migration Options

### Option A: Direct Migration (Recommended)

1. Edit the migration script with your Atlas credentials:
```bash
nano scripts/migrate-from-atlas.sh
```

2. Update the ATLAS_URI with your connection string:
```bash
ATLAS_URI="mongodb+srv://your_username:your_password@your_cluster.mongodb.net"
```

3. Run the migration:
```bash
bash scripts/migrate-from-atlas.sh
```

### Option B: Using MongoDB Compass Exports

1. Export each collection from MongoDB Compass as JSON
2. Transfer files to your VPS
3. Run the import script:
```bash
bash scripts/import-compass-exports.sh /path/to/exports
```

## Step 4: Verify Migration

```bash
# Connect to local MongoDB
mongosh

# List databases
show dbs

# Check a specific database
use sbc_user_dev
show collections
db.users.countDocuments()
```

## Step 5: Update Application Configuration

Your Docker Compose is already configured correctly with:
```yaml
MONGODB_URI_DEV: mongodb://host.docker.internal:27017/database_name
```

## Step 6: Test Application

```bash
# Restart your services
docker-compose down
docker-compose up -d

# Check service health
docker-compose ps
```

## Step 7: Setup Automated Backups

1. Install Google Drive backup system:
```bash
sudo bash scripts/setup-gdrive-backup.sh
```

2. Configure rclone with Google Drive:
```bash
sudo rclone config
```

3. Setup automated backups:
```bash
sudo cp scripts/mongodb-backup.sh /opt/mongodb-backup/scripts/
sudo cp scripts/mongodb-restore.sh /opt/mongodb-backup/scripts/
sudo bash scripts/setup-cron-backup.sh
```

## Troubleshooting

### Connection Issues
- Ensure MongoDB is running: `sudo systemctl status mongod`
- Check firewall: `sudo ufw status`
- Verify port 27017 is listening: `sudo netstat -tlnp | grep 27017`

### Permission Issues
- Check MongoDB logs: `sudo tail -f /var/log/mongodb/mongod.log`
- Verify data directory permissions: `ls -la /var/lib/mongodb`

### Docker Connection Issues
- Ensure `host.docker.internal` resolves correctly
- Alternative: Use `172.17.0.1` (Docker bridge IP) instead

## Performance Optimization

### MongoDB Configuration
```yaml
# Add to /etc/mongod.conf
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 1  # Adjust based on available RAM
    collectionConfig:
      blockCompressor: snappy
```

### System Optimization
```bash
# Increase file descriptor limits
echo "mongodb soft nofile 64000" | sudo tee -a /etc/security/limits.conf
echo "mongodb hard nofile 64000" | sudo tee -a /etc/security/limits.conf
```

## Backup Strategy

- **Daily backups** at 2 AM (configurable)
- **Local retention**: 30 days
- **Google Drive retention**: 90 days
- **Compression**: gzip for space efficiency
- **Monitoring**: Logs available at `/var/log/mongodb-backup/backup.log`

## Security Best Practices

1. **Enable authentication** (done in installation script)
2. **Bind to localhost only** (prevents external access)
3. **Regular backups** (automated)
4. **Monitor logs** for suspicious activity
5. **Keep MongoDB updated**

## Maintenance Commands

```bash
# Manual backup
sudo /opt/mongodb-backup/scripts/mongodb-backup.sh

# List available backups
bash scripts/mongodb-restore.sh list

# Restore specific database
bash scripts/mongodb-restore.sh backup_file.tar.gz sbc_user_dev

# Check backup logs
tail -f /var/log/mongodb-backup/backup.log

# MongoDB maintenance
mongosh --eval "db.runCommand({compact: 'collection_name'})"
```
