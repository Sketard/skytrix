#!/bin/bash
# Skytrix Deployment Script
# Usage: ./scripts/deploy.sh [vps-ip]
# Runs from local machine, executes on VPS via SSH.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

VPS_IP="${1:-51.195.201.43}"
VPS_USER="ubuntu"
VPS_PATH="/home/ubuntu/skytrix"
BACKUP_DIR="/home/ubuntu/backups/skytrix"

log()   { echo -e "${GREEN}[✓] $1${NC}"; }
warn()  { echo -e "${YELLOW}[!] $1${NC}"; }
fail()  { echo -e "${RED}[✗] $1${NC}"; exit 1; }
step()  { echo -e "\n${YELLOW}[$1] $2${NC}"; }

remote() { ssh -o ConnectTimeout=10 "$VPS_USER@$VPS_IP" bash -s <<< "$1"; }

# ── Step 1: Pre-flight checks ───────────────────────────────────────────────

step "1/7" "Pre-flight checks"

ssh -o ConnectTimeout=5 -o BatchMode=yes "$VPS_USER@$VPS_IP" true 2>/dev/null \
  || fail "Cannot connect to $VPS_USER@$VPS_IP"
log "SSH connection OK"

PREFLIGHT=$(remote "
  docker compose version > /dev/null 2>&1 || { echo 'NO_COMPOSE'; exit 1; }
  AVAIL=\$(df --output=avail -BG / | tail -1 | tr -d ' G')
  if [ \"\$AVAIL\" -lt 2 ]; then echo 'LOW_DISK'; exit 1; fi
  echo \"OK \${AVAIL}G available\"
")
[[ "$PREFLIGHT" == LOW_DISK ]] && fail "Less than 2 GB disk space available"
[[ "$PREFLIGHT" == NO_COMPOSE ]] && fail "Docker Compose not found on VPS"
log "Docker Compose OK — ${PREFLIGHT#OK }"

# ── Step 2: Backup DB ───────────────────────────────────────────────────────

step "2/7" "Backup PostgreSQL"

BACKUP_RESULT=$(remote "
  set -euo pipefail
  mkdir -p $BACKUP_DIR

  TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE=\"$BACKUP_DIR/skytrix_\${TIMESTAMP}.sql.gz\"

  docker exec skytrix-db pg_dump -U \$(docker exec skytrix-db printenv POSTGRES_USER) \
    \$(docker exec skytrix-db printenv POSTGRES_DB) \
    | gzip > \"\$BACKUP_FILE\"

  SIZE=\$(du -h \"\$BACKUP_FILE\" | cut -f1)
  echo \"\$BACKUP_FILE|\$SIZE\"
") || fail "Database backup failed — aborting deployment"

BACKUP_FILE=$(echo "$BACKUP_RESULT" | cut -d'|' -f1)
BACKUP_SIZE=$(echo "$BACKUP_RESULT" | cut -d'|' -f2)
log "Backup created: $BACKUP_SIZE ($BACKUP_FILE)"

# Retention: 7 daily + 4 weekly
step "2b/7" "Backup retention cleanup"
remote "
  set -euo pipefail
  cd $BACKUP_DIR

  # Keep all backups from the last 7 days
  find . -name 'skytrix_*.sql.gz' -mtime +7 | sort > /tmp/old_backups.txt

  # Among older backups, keep one per week (Monday or oldest in that week)
  KEEP_WEEKLY=()
  while IFS= read -r f; do
    WEEK=\$(date -d \"\$(stat -c %Y \"\$f\" | xargs -I{} date -d @{} +%Y-%W)\" +%Y-%W 2>/dev/null \
           || stat -c %Y \"\$f\" | xargs -I{} date -d @{} +%Y-%W)
    if [[ ! \" \${KEEP_WEEKLY[*]:-} \" =~ \" \$WEEK \" ]]; then
      KEEP_WEEKLY+=(\"\$WEEK\")
    else
      rm -f \"\$f\"
    fi
  done < /tmp/old_backups.txt

  # Remove weekly backups older than 28 days
  find . -name 'skytrix_*.sql.gz' -mtime +28 -delete

  COUNT=\$(ls -1 skytrix_*.sql.gz 2>/dev/null | wc -l)
  echo \"\$COUNT backups retained\"
"
log "Retention policy applied"

# ── Step 3: Git pull ─────────────────────────────────────────────────────────

step "3/7" "Git pull"

GIT_RESULT=$(remote "
  cd $VPS_PATH
  git fetch origin
  LOCAL=\$(git rev-parse HEAD)
  REMOTE=\$(git rev-parse origin/master)

  if [ \"\$LOCAL\" = \"\$REMOTE\" ]; then
    echo 'UP_TO_DATE'
  else
    git reset --hard origin/master 2>&1
    echo 'UPDATED'
  fi
") || fail "Git sync failed on VPS"

if [[ "$GIT_RESULT" == *"UP_TO_DATE"* ]]; then
  warn "Already up to date — continuing with rebuild"
else
  log "Code updated"
fi

# ── Step 4: Build ────────────────────────────────────────────────────────────

step "4/7" "Docker build (services stay up)"

remote "cd $VPS_PATH && docker compose build" \
  || fail "Docker build failed"
log "Build complete"

# ── Step 5: Deploy ───────────────────────────────────────────────────────────

step "5/7" "Deploy (restart changed services)"

remote "cd $VPS_PATH && docker compose up -d" \
  || fail "docker compose up failed"
log "Services updated"

# ── Step 6: Healthcheck ──────────────────────────────────────────────────────

step "6/7" "Healthcheck (60s timeout)"

HEALTH_RESULT=$(remote "
  SERVICES='skytrix-db skytrix-back skytrix-duel-server'
  MAX_WAIT=60
  ELAPSED=0

  while [ \$ELAPSED -lt \$MAX_WAIT ]; do
    ALL_HEALTHY=true
    for svc in \$SERVICES; do
      STATUS=\$(docker inspect --format='{{.State.Health.Status}}' \"\$svc\" 2>/dev/null || echo 'no-healthcheck')
      if [ \"\$STATUS\" = 'starting' ]; then
        ALL_HEALTHY=false
      elif [ \"\$STATUS\" = 'unhealthy' ] && [ \$ELAPSED -ge \$MAX_WAIT ]; then
        echo \"UNHEALTHY|\$svc\"
        exit 1
      elif [ \"\$STATUS\" = 'unhealthy' ]; then
        ALL_HEALTHY=false
      fi
    done

    if \$ALL_HEALTHY; then
      echo 'ALL_HEALTHY'
      exit 0
    fi

    sleep 5
    ELAPSED=\$((ELAPSED + 5))
  done

  # Timeout — check final status
  for svc in \$SERVICES; do
    STATUS=\$(docker inspect --format='{{.State.Health.Status}}' \"\$svc\" 2>/dev/null || echo 'none')
    if [ \"\$STATUS\" != 'healthy' ] && [ \"\$STATUS\" != 'none' ]; then
      echo \"UNHEALTHY|\$svc\"
      docker logs --tail 15 \"\$svc\" 2>&1
      exit 1
    fi
  done
  echo 'ALL_HEALTHY'
")

if [[ "$HEALTH_RESULT" == *"UNHEALTHY"* ]]; then
  FAILED_SVC=$(echo "$HEALTH_RESULT" | head -1 | cut -d'|' -f2)
  warn "Service $FAILED_SVC is unhealthy. Logs:"
  echo "$HEALTH_RESULT" | tail -n +2
  warn "Deployment completed but $FAILED_SVC needs attention"
else
  log "All services healthy"
fi

# ── Step 7: Cleanup ─────────────────────────────────────────────────────────

step "7/7" "Cleanup dangling images"

PRUNED=$(remote "docker image prune -f 2>/dev/null | tail -1")
log "Pruned: $PRUNED"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Deployment complete${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""

remote "
  cd $VPS_PATH
  echo 'Containers:'
  docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || docker compose ps
  echo ''
  BACKUP_COUNT=\$(ls -1 $BACKUP_DIR/skytrix_*.sql.gz 2>/dev/null | wc -l)
  BACKUP_TOTAL=\$(du -sh $BACKUP_DIR 2>/dev/null | cut -f1)
  echo \"Backups: \$BACKUP_COUNT files (\$BACKUP_TOTAL total)\"
"
