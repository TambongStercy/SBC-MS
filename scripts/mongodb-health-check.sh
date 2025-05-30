#!/bin/bash

# MongoDB Health Check and Monitoring Script

echo "MongoDB Health Check Report"
echo "=========================="
echo "Timestamp: $(date)"
echo ""

# Check MongoDB service status
echo "1. MongoDB Service Status:"
if systemctl is-active --quiet mongod; then
    echo "   ✅ MongoDB service is running"
else
    echo "   ❌ MongoDB service is not running"
    echo "   Try: sudo systemctl start mongod"
fi

# Check MongoDB process
echo ""
echo "2. MongoDB Process:"
if pgrep -x mongod > /dev/null; then
    echo "   ✅ MongoDB process is active"
    echo "   PID: $(pgrep -x mongod)"
else
    echo "   ❌ MongoDB process not found"
fi

# Check port availability
echo ""
echo "3. Port 27017 Status:"
if netstat -tlnp 2>/dev/null | grep -q ":27017"; then
    echo "   ✅ Port 27017 is listening"
else
    echo "   ❌ Port 27017 is not listening"
fi

# Check disk space
echo ""
echo "4. Disk Space:"
df -h /var/lib/mongodb 2>/dev/null || df -h /

# Check MongoDB connection
echo ""
echo "5. MongoDB Connection Test:"
if mongosh --quiet --eval "db.runCommand('ping')" > /dev/null 2>&1; then
    echo "   ✅ MongoDB connection successful"
else
    echo "   ❌ Cannot connect to MongoDB"
fi

# Check databases
echo ""
echo "6. Database Status:"
if mongosh --quiet --eval "show dbs" 2>/dev/null; then
    echo "   ✅ Databases accessible"
    
    # Count documents in each database
    echo ""
    echo "7. Document Counts:"
    for db in sbc_user_dev sbc_payment_dev sbc_product_dev sbc_notification_dev sbc_advertising_dev sbc_tombola_dev sbc_settings_dev; do
        count=$(mongosh --quiet --eval "use $db; db.stats().objects" 2>/dev/null || echo "0")
        echo "   $db: $count documents"
    done
else
    echo "   ❌ Cannot access databases"
fi

# Check recent backup status
echo ""
echo "8. Recent Backup Status:"
if [ -f "/var/log/mongodb-backup/backup.log" ]; then
    echo "   Last backup log entries:"
    tail -n 5 /var/log/mongodb-backup/backup.log | sed 's/^/   /'
else
    echo "   ❌ No backup log found"
fi

# Check available backups
echo ""
echo "9. Available Backups:"
if [ -d "/opt/mongodb-backup/temp" ]; then
    backup_count=$(ls -1 /opt/mongodb-backup/temp/*.tar.gz 2>/dev/null | wc -l)
    echo "   Local backups: $backup_count"
    if [ $backup_count -gt 0 ]; then
        echo "   Latest backup: $(ls -t /opt/mongodb-backup/temp/*.tar.gz 2>/dev/null | head -1 | xargs basename)"
    fi
else
    echo "   ❌ Backup directory not found"
fi

# Check Google Drive backup status
echo ""
echo "10. Google Drive Backup Status:"
if command -v rclone > /dev/null; then
    echo "   ✅ rclone is installed"
    gdrive_backups=$(rclone ls gdrive:mongodb-backups/ 2>/dev/null | wc -l)
    echo "   Google Drive backups: $gdrive_backups"
else
    echo "   ❌ rclone not installed"
fi

echo ""
echo "=========================="
echo "Health check completed"
