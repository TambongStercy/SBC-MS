#!/bin/bash
# Runs inside the mongo:8.0 container (see test-mongo.sh). Asserts:
#  hooks install once and keep bash -n; the backup writes sbc-manifest.json (before/after counts,
#  no preprod DB) and status mongo.lastOk; the restore test (from the fake R2) passes, drops
#  everything and records the counts; a backup whose manifest claims more users fails; an R2 copy
#  that differs from the local one fails; a failing dump marks mongo.lastOk=false.
set -u
fails=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi; }
export SBC_BACKUP_STATUS=/var/lib/sbc-backup/status.json R2_ENV_FILE=/tmp/r2.env
echo "R2_ACCOUNT_ID=x" > /tmp/r2.env
mkdir -p /fake-r2 /usr/local/bin
cat > /usr/local/bin/rclone <<'R'
#!/bin/bash
# fake rclone: r2:<bucket>/<path> → /fake-r2/<bucket>/<path>
map() { case "$1" in r2:*) echo "/fake-r2/${1#r2:}";; *) echo "$1";; esac; }
case "$1" in
  copyto) mkdir -p "$(dirname "$(map "$3")")"; cp "$(map "$2")" "$(map "$3")";;
  delete) exit 0;;
  *) exit 1;;
esac
R
chmod +x /usr/local/bin/rclone
mongod --dbpath /data/db --port 27017 --bind_ip 127.0.0.1 --fork --logpath /tmp/prod.log >/dev/null
mongosh --quiet --eval '
  const u = db.getSiblingDB("sbc_users"), p = db.getSiblingDB("sbc_payment"), pp = db.getSiblingDB("sbc_users_preprod");
  u.users.insertMany(Array.from({length: 1500}, (_, i) => ({ i, email: `m${i}@x.test` })));
  u.referrals.insertMany(Array.from({length: 700}, (_, i) => ({ i })));
  p.transactions.insertMany(Array.from({length: 3000}, (_, i) => ({ i, amount: i })));
  p.paymentintents.insertMany(Array.from({length: 400}, (_, i) => ({ i })));
  pp.users.insertMany([{ preprod: true }]);' >/dev/null

cp /src/tests/fixture-mongodb-backup.sh /root/mongodb-backup.sh
bash /src/install-mongo-hooks.sh /root/mongodb-backup.sh >/tmp/install.log 2>&1
check "hooks installed, syntax ok" 'grep -q "hooks installed (3 failure exits)" /tmp/install.log && bash -n /root/mongodb-backup.sh'
bash /src/install-mongo-hooks.sh /root/mongodb-backup.sh | grep -q "already installed"; check "installer is idempotent" '[ $(grep -c sbc_hook_before /root/mongodb-backup.sh) = 2 ]'

bash /root/mongodb-backup.sh > /tmp/backup.log 2>&1
f=$(ls -1t /var/backups/sbc-mongodb/*.tar.gz | head -1)
tar -xzf "$f" -C /tmp --wildcards '*/sbc-manifest.json'
m=$(find /tmp/mongodb_backup_* -name sbc-manifest.json | head -1)
check "backup made and kept, manifest inside" '[ -n "$f" ] && [ -f "$m" ]'
check "manifest: before and after counts, no preprod" 'python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); b=d[\"before\"]; assert b[\"sbc_users\"][\"users\"]==1500 and d[\"after\"][\"sbc_payment\"][\"transactions\"]==3000 and not any(k.endswith(\"_preprod\") for k in b)" "$m"'
check "status: mongo lastOk with size" 'python3 -I -c "import json; m=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"mongo\"]; assert m[\"lastOk\"] and m[\"sizeBytes\"]>0 and not m[\"running\"]"'

KEEP_DIR=/var/backups/sbc-mongodb R2_PATH=r2:sbc-db-backups/mongodb-backups MIN_FREE_GB=1 bash /src/mongo-restore-test.sh > /tmp/rt.log 2>&1; rc=$?
check "restore test from R2 passes" '[ $rc = 0 ] && grep -q "Restore test passed" /tmp/rt.log'; [ $rc = 0 ] || sed -n "1,30p" /tmp/rt.log
check "status: restore ok, documents counted, collections checked" 'python3 -I -c "import json; r=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"restore_mongo\"]; assert r[\"ok\"] and r[\"documents\"]==5600 and r[\"collectionsChecked\"]==4, r"'
check "work dir removed, throwaway mongod stopped" '[ ! -e /var/tmp/sbc-restore-test ] && ! mongosh --quiet --port 27999 --eval 1 >/dev/null 2>&1'
check "prod mongod untouched" '[ "$(mongosh --quiet --eval "db.getSiblingDB(\"sbc_users\").users.countDocuments()")" = 1500 ]'

# a backup whose manifest says more users than were dumped
d=$(mktemp -d); tar -xzf "$f" -C "$d"; dd=$(ls "$d")
python3 -I -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m['before']['sbc_users']['users']=1600; m['after']['sbc_users']['users']=1600; json.dump(m,open(p,'w'))" "$d/$dd/sbc-manifest.json"
bad=/var/backups/sbc-mongodb/mongodb_backup_29991231_000000.tar.gz; tar -czf "$bad" -C "$d" "$dd"; touch "$bad"
BACKUP_SOURCE=local KEEP_DIR=/var/backups/sbc-mongodb MIN_FREE_GB=1 bash /src/mongo-restore-test.sh > /tmp/rt2.log 2>&1; rc=$?
check "missing users detected → fails, status ok=false" '[ $rc = 1 ] && grep -q "sbc_users.users: 1500 restored, expected 1600..1600" /tmp/rt2.log && python3 -I -c "import json; assert not json.load(open(\"$SBC_BACKUP_STATUS\"))[\"restore_mongo\"][\"ok\"]"'
# the R2 copy differs from the local one
mkdir -p /fake-r2/sbc-db-backups/mongodb-backups; echo corrupt > "/fake-r2/sbc-db-backups/mongodb-backups/$(basename $bad)"
KEEP_DIR=/var/backups/sbc-mongodb R2_PATH=r2:sbc-db-backups/mongodb-backups MIN_FREE_GB=1 bash /src/mongo-restore-test.sh > /tmp/rt3.log 2>&1; rc=$?
check "R2 copy differing from local → fails" '[ $rc = 1 ] && grep -q "differs from the local copy" /tmp/rt3.log'
check "not enough disk → fails before anything" 'MIN_FREE_GB=999999 BACKUP_SOURCE=local bash /src/mongo-restore-test.sh 2>&1 | grep -q "GB free"'

# preprod: its own backup (only *_preprod) and restore test
mongosh --quiet --eval 'db.getSiblingDB("sbc_payment_preprod").transactions.insertMany(Array.from({length: 250}, (_, i) => ({ i })))' >/dev/null
R2_PATH=r2:sbc-db-backups/preprod-mongodb-backups bash /src/mongo-preprod-backup.sh > /tmp/pb.log 2>&1; rc=$?
pf=$(ls -1t /var/backups/sbc-mongodb-preprod/*.tar.gz 2>/dev/null | head -1)
check "preprod backup: only *_preprod databases, manifest scope preprod" '[ $rc = 0 ] && [ -n "$pf" ] && tar -tzf "$pf" | grep -q "sbc_payment_preprod/" && ! tar -tzf "$pf" | grep -qE "/sbc_users/|/sbc_payment/" && tar -xzOf "$pf" --wildcards "*/sbc-manifest.json" | grep -q "\"scope\": \"preprod\""'
check "preprod backup in fake R2, status mongo_preprod ok" '[ -f "/fake-r2/sbc-db-backups/preprod-mongodb-backups/$(basename "$pf")" ] && python3 -I -c "import json; assert json.load(open(\"$SBC_BACKUP_STATUS\"))[\"mongo_preprod\"][\"lastOk\"]"'
KEEP_DIR=/var/backups/sbc-mongodb-preprod PATTERN="mongodb_preprod_backup_*.tar.gz" R2_PATH=r2:sbc-db-backups/preprod-mongodb-backups \
  KEY_COLLECTIONS="sbc_users_preprod.users sbc_payment_preprod.transactions" STATUS_KEY=restore_mongo_preprod MIN_FREE_GB=1 bash /src/mongo-restore-test.sh > /tmp/prt.log 2>&1; rc=$?
check "preprod restore test passes under its own key" '[ $rc = 0 ] && python3 -I -c "import json; r=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"restore_mongo_preprod\"]; assert r[\"ok\"] and r[\"documents\"]==251, r"'; [ $rc = 0 ] || tail -5 /tmp/prt.log

# a failing dump
sed -i 's/MONGO_PORT="27017"/MONGO_PORT="27099"/' /root/mongodb-backup.sh
bash /root/mongodb-backup.sh > /tmp/backup2.log 2>&1
check "failed dump → status mongo lastOk=false" 'python3 -I -c "import json; m=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"mongo\"]; assert m[\"lastOk\"] is False and not m[\"running\"]"'
echo; [ $fails = 0 ] && echo "all passed" || echo "$fails FAILED"
exit $fails
