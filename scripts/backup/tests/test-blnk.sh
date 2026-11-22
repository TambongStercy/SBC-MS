#!/bin/bash
# Local test of the Blnk backup, restore test, forced command and pull, against a throwaway
# PostgreSQL container (postgres:17-alpine) on 127.0.0.1:55432. Asserts the dump + manifest, the
# kept count, the restore test (pass, then a tampered manifest fails), the forced command's two
# allowed answers and its refusal, and the pull (copied, R2 upload through a fake rclone, status
# merged from the "secondary").
set -u
here="$(cd "$(dirname "$0")/.." && pwd)"; fails=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi; }
T=$(mktemp -d); trap 'docker rm -f sbc-blnk-backup-test >/dev/null 2>&1; rm -rf "$T"' EXIT
docker run -d --rm --name sbc-blnk-backup-test -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null
export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=pw PG_AS="" SBC_BACKUP_HOME="$here"
until psql -X -q -d postgres -c 'select 1' >/dev/null 2>&1; do sleep 1; done
psql -X -q -d postgres -c 'create database blnk_preprod' >/dev/null
psql -X -q -d blnk_preprod -c "create schema blnk; create table blnk.transactions(id serial primary key, amount numeric);
  create table blnk.balances(id serial primary key, balance numeric); insert into blnk.transactions(amount) select g from generate_series(1,1200) g;
  insert into blnk.balances(balance) select g from generate_series(1,80) g;" >/dev/null

# secondary side
export SBC_BACKUP_STATUS="$T/secondary/status.json" KEEP_DIR="$T/secondary/blnk"
for i in 1 2 3; do bash "$here/blnk-backup.sh" > "$T/b$i.log" 2>&1; sleep 1; done
check "backup: dump + manifest, before/after counts" 'ls "$KEEP_DIR"/blnk_preprod_*.dump >/dev/null && python3 -I -c "import json,glob; m=json.load(open(sorted(glob.glob(\"$KEEP_DIR/*.manifest.json\"))[-1])); assert m[\"before\"][\"blnk.transactions\"]==1200 and m[\"after\"][\"blnk.balances\"]==80"'
KEEP=2 bash "$here/blnk-backup.sh" >/dev/null 2>&1
check "only the last KEEP dumps (and their manifests) are kept" '[ $(ls "$KEEP_DIR"/*.dump | wc -l) = 2 ] && [ $(ls "$KEEP_DIR"/*.manifest.json | wc -l) = 2 ]'
check "status blnk_preprod ok" 'python3 -I -c "import json; s=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"blnk_preprod\"]; assert s[\"lastOk\"] and s[\"sizeBytes\"]>0"'
bash "$here/blnk-restore-test.sh" > "$T/r.log" 2>&1; rc=$?
left=$(psql -X -At -d postgres -c "select count(*) from pg_database where datname like 'sbc_restoretest%'")
check "restore test passes, temp database dropped" '[ $rc = 0 ] && python3 -I -c "import json; r=json.load(open(\"$SBC_BACKUP_STATUS\"))[\"restore_blnk_preprod\"]; assert r[\"ok\"] and r[\"rows\"]==1280 and r[\"tables\"]==2, r" && [ "$left" = 0 ]' || tail -3 "$T/r.log"
m=$(ls -1t "$KEEP_DIR"/*.manifest.json | head -1); cp "$m" "$T/m.bak"
python3 -I -c "import json,sys; p=sys.argv[1]; d=json.load(open(p)); d['before']['blnk.transactions']=1300; d['after']['blnk.transactions']=1300; json.dump(d,open(p,'w'))" "$m"
bash "$here/blnk-restore-test.sh" > "$T/r2.log" 2>&1; rc=$?
check "rows missing from the dump → restore test fails" '[ $rc = 1 ] && grep -q "blnk.transactions: 1200 restored, expected 1300..1300" "$T/r2.log"'
cp "$T/m.bak" "$m"

# the forced command
out=$(SSH_ORIGINAL_COMMAND=latest bash "$here/blnk-serve.sh" | tar -tf -)
check "forced command 'latest': newest dump + manifest" 'echo "$out" | grep -q "\.dump$" && echo "$out" | grep -q "\.manifest\.json$" && [ $(echo "$out" | wc -l) = 2 ]'
check "forced command 'status': the status json" 'SSH_ORIGINAL_COMMAND=status bash "$here/blnk-serve.sh" | python3 -I -c "import json,sys; assert \"blnk_preprod\" in json.load(sys.stdin)"'
check "forced command refuses anything else" '! SSH_ORIGINAL_COMMAND="cat /etc/passwd" bash "$here/blnk-serve.sh" >/dev/null 2>&1 && ! SSH_ORIGINAL_COMMAND="latest; id" bash "$here/blnk-serve.sh" >/dev/null 2>&1'

# main side: pull through a fake ssh (runs the forced command), R2 through a fake rclone
mkdir -p "$T/bin" "$T/r2"
printf '#!/bin/bash\nshift\nSSH_ORIGINAL_COMMAND="$1" KEEP_DIR="%s" SBC_BACKUP_STATUS="%s" bash "%s/blnk-serve.sh"\n' "$KEEP_DIR" "$SBC_BACKUP_STATUS" "$here" > "$T/bin/fake-ssh"
printf '#!/bin/bash\nmap() { case "$1" in r2:*) echo "%s/${1#r2:}";; *) echo "$1";; esac; }\ncase "$1" in copyto) mkdir -p "$(dirname "$(map "$3")")"; cp "$(map "$2")" "$(map "$3")";; delete) exit 0;; esac\n' "$T/r2" > "$T/bin/rclone"
chmod +x "$T/bin/"*; echo "R2_ACCOUNT_ID=x" > "$T/r2.env"
PATH="$T/bin:$PATH" R2_ENV_FILE="$T/r2.env" SSH_CMD="$T/bin/fake-ssh" SBC_BACKUP_STATUS="$T/main/status.json" KEEP_DIR="$T/main/blnk" bash "$here/blnk-pull.sh" > "$T/p.log" 2>&1; rc=$?
check "pull: dump kept on main, uploaded to R2 with its manifest" '[ $rc = 0 ] && ls "$T/main/blnk"/*.dump >/dev/null && ls "$T/r2/sbc-db-backups/blnk-backups/"*.dump >/dev/null && ls "$T/r2/sbc-db-backups/blnk-backups/"*.manifest.json >/dev/null' || tail -3 "$T/p.log"
check "pull: main status has blnk_offsite ok + the secondary backup and restore records" 'python3 -I -c "import json; s=json.load(open(\"$T/main/status.json\")); assert s[\"blnk_offsite\"][\"lastOk\"] and s[\"blnk_preprod\"][\"lastOk\"] and \"restore_blnk_preprod\" in s, s.keys()"'
check "main's copy is private (dir 700)" '[ "$(stat -c %a "$T/main/blnk")" = 700 ]'
echo; [ $fails = 0 ] && echo "all passed" || echo "$fails FAILED"; exit $fails
