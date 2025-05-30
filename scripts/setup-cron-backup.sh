#!/bin/bash

# Setup automated cron jobs for MongoDB backup

echo "Setting up automated MongoDB backup cron jobs..."

# Make backup script executable
sudo chmod +x /opt/mongodb-backup/scripts/mongodb-backup.sh
sudo chmod +x /opt/mongodb-backup/scripts/mongodb-restore.sh

# Create cron job for daily backups at 2 AM
echo "Setting up daily backup at 2:00 AM..."

# Add cron job
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/mongodb-backup/scripts/mongodb-backup.sh") | crontab -

# Alternative schedules (uncomment as needed):

# Weekly backup (Sundays at 3 AM)
# (crontab -l 2>/dev/null; echo "0 3 * * 0 /opt/mongodb-backup/scripts/mongodb-backup.sh") | crontab -

# Twice daily backup (2 AM and 2 PM)
# (crontab -l 2>/dev/null; echo "0 2,14 * * * /opt/mongodb-backup/scripts/mongodb-backup.sh") | crontab -

echo "Cron job setup completed!"
echo ""
echo "Current cron jobs:"
crontab -l

echo ""
echo "To modify backup schedule:"
echo "  crontab -e"
echo ""
echo "Backup logs will be available at:"
echo "  /var/log/mongodb-backup/backup.log"
echo ""
echo "To test backup manually:"
echo "  sudo /opt/mongodb-backup/scripts/mongodb-backup.sh"
