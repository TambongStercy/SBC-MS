#!/bin/bash

# Google Drive Backup Setup Script
# This script sets up automated MongoDB backups to Google Drive

echo "Setting up Google Drive backup system..."

# Install rclone for Google Drive integration
echo "Installing rclone..."
curl https://rclone.org/install.sh | sudo bash

# Create backup directories
sudo mkdir -p /opt/mongodb-backup/{scripts,logs,temp}
sudo mkdir -p /var/log/mongodb-backup

echo "Rclone installed successfully!"
echo ""
echo "Next steps:"
echo "1. Configure rclone with Google Drive:"
echo "   sudo rclone config"
echo "2. Follow the interactive setup to connect to Google Drive"
echo "3. Name your remote 'gdrive' when prompted"
echo "4. Run the backup script setup after rclone configuration"
echo ""
echo "To configure rclone:"
echo "- Choose 'n' for new remote"
echo "- Name: gdrive"
echo "- Storage: Google Drive (option 15 or similar)"
echo "- Follow the authentication flow"
