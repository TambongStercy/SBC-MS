FROM mongo:7

# Install Google Cloud SDK and cron
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    cron \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] http://packages.cloud.google.com/apt cloud-sdk main" | tee /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update && apt-get install -y google-cloud-cli \
    && rm -rf /var/lib/apt/lists/*

# Copy backup script and crontab
COPY backup.sh /backup.sh
COPY crontab /etc/cron.d/backup-cron

# Set permissions
RUN chmod +x /backup.sh \
    && chmod 0644 /etc/cron.d/backup-cron \
    && crontab /etc/cron.d/backup-cron \
    && touch /var/log/backup.log

# Run cron in foreground
CMD ["cron", "-f"]
