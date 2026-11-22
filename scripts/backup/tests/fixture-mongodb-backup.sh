#!/bin/bash
# Same structure and log lines as the main server's /root/mongodb-backup.sh (the anchors the hook
# installer uses), without its credentials; R2 goes to the fake rclone of the test.
MONGO_HOST="localhost"
MONGO_PORT="27017"
MONGO_USER=""
MONGO_PASSWORD=""
R2_BUCKET="sbc-db-backups"
LOCAL_KEEP_DIR="/var/backups/sbc-mongodb"
r2() { rclone "$@" --s3-no-head; }
BACKUP_DIR="/tmp/mongodb-backups"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="mongodb_backup_$DATE"
mkdir -p $BACKUP_DIR
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}
log "Starting MongoDB backup process..."
if [ -z "$MONGO_USER" ]; then
    log "Creating backup without authentication..."
    mongodump --host $MONGO_HOST:$MONGO_PORT --out $BACKUP_DIR/$BACKUP_NAME
else
    log "Creating backup with authentication..."
    mongodump --host $MONGO_HOST:$MONGO_PORT --username $MONGO_USER --password $MONGO_PASSWORD --authenticationDatabase admin --out $BACKUP_DIR/$BACKUP_NAME
fi
if [ $? -eq 0 ]; then
    log "MongoDB backup created successfully"
    log "Removing preprod databases from backup..."
    rm -rf $BACKUP_DIR/$BACKUP_NAME/*_preprod
    log "Compressing backup..."
    cd $BACKUP_DIR
    tar -czf $BACKUP_NAME.tar.gz $BACKUP_NAME
    if [ $? -eq 0 ]; then
        log "Backup compressed successfully"
        r2 copyto $BACKUP_NAME.tar.gz r2:$R2_BUCKET/mongodb-backups/$BACKUP_NAME.tar.gz
        if [ $? -eq 0 ]; then
            log "Backup uploaded successfully"
            rm -rf $BACKUP_DIR/$BACKUP_NAME
            mkdir -p $LOCAL_KEEP_DIR && mv $BACKUP_DIR/$BACKUP_NAME.tar.gz $LOCAL_KEEP_DIR/
            ls -1t $LOCAL_KEEP_DIR/mongodb_backup_*.tar.gz | tail -n +4 | xargs -r rm -f
            log "Backup process completed successfully"
        else
            log "ERROR: Failed to upload backup to Cloudflare R2"
            exit 1
        fi
    else
        log "ERROR: Failed to compress backup"
        exit 1
    fi
else
    log "ERROR: Failed to create MongoDB backup"
    exit 1
fi
log "Backup script finished"
