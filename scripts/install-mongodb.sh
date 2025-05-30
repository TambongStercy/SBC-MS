#!/bin/bash

# MongoDB Installation Script for Ubuntu VPS
# Run with: sudo bash install-mongodb.sh

echo "Installing MongoDB on Ubuntu..."

# Import the public key used by the package management system
wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -

# Create a list file for MongoDB
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Reload local package database
sudo apt-get update

# Install MongoDB packages
sudo apt-get install -y mongodb-org

# Start MongoDB service
sudo systemctl start mongod

# Enable MongoDB to start on boot
sudo systemctl enable mongod

# Check status
sudo systemctl status mongod

echo "MongoDB installation completed!"
echo "MongoDB is running on: mongodb://localhost:27017"

# Create admin user (optional but recommended)
echo "Creating admin user..."
mongosh --eval "
use admin
db.createUser({
  user: 'admin',
  pwd: 'your_secure_password_here',
  roles: [
    { role: 'userAdminAnyDatabase', db: 'admin' },
    { role: 'readWriteAnyDatabase', db: 'admin' },
    { role: 'dbAdminAnyDatabase', db: 'admin' }
  ]
})
"

echo "Setup complete! Remember to:"
echo "1. Change the admin password in this script"
echo "2. Configure firewall rules if needed"
echo "3. Update your application connection strings"
