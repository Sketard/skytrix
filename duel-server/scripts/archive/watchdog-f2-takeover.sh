#!/usr/bin/env bash
# =============================================================================
# Watchdog: F2 step 1 takeover + α multi-seed linear v3
#
# Polls for F2 step 1 (seed 7 det train) completion via weights file existence.
# Once detected, kills the running F2 step 2 (seed 42 det train) which would
# cost ~7h additional with diminishing return, and replaces with α experiments.
#
# α plan: linear v3 multi-seed (sd 7 + sd 11) — tests if MLP arch lift seen
# in F1 (linear v3 sd42 = 18 matched, MLP v3 median = 20) was real or
# single-seed luck. Per-seed comparison directly informs Sprint 3 arch vs
# features priorisation.
#
# Total post-takeover compute ~3h45min:
#   - cum eval seed 7 det @ prod regime + bonus F1 sd7 @ det eval (~10min)
#   - linear v3 sd7 train (~1h46)
#   - linear v3 sd11 train (~1h46)
#   - cum evals × 2 final (~5min)
#
# Usage: ./scripts/watchdog-f2-takeover.sh
# Best launched as a background task that can run while F2 step 1 finishes.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

WEIGHTS_FILE="data/trained-weights/neural-mlpv3-detregime-seed7.json"

echo "=== Watchdog starting $(date -u +%H:%M:%SZ) ==="
echo "Polling for ${WEIGHTS_FILE} (step 1 completion signal)..."

# Poll every 60s for step 1 weights file appearance
while [ ! -f "${WEIGHTS_FILE}" ]; do
  sleep 60
done

echo "=== Step 1 done at $(date -u +%H:%M:%SZ) ==="

# Kill F2 step 2 (seed 42 det train) — should be just starting or about to.
# Two-pronged kill: target the inner node process AND the wrapper bash so it
# doesn't proceed to its own cum eval phase (we'll do that ourselves).
echo "Killing F2 step 2 (seed 42 det train) and wrapper..."
pkill -f "train-neural.ts.*--seed=42.*--budget-ms=30000" 2>/dev/null || true
pkill -f "run-overnight-f2.sh" 2>/dev/null || true
sleep 5

ISO=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR="data/training-logs/post-f2step1-takeover-${ISO}"
mkdir -p "$LOG_DIR"
echo "Logs → ${LOG_DIR}"

# -----------------------------------------------------------------------------
# Step 1: Cum eval seed 7 det weights @ production regime (budget-ms=6000)
# Direct comparison vs F1 production-trained seed 7 numbers.
# -----------------------------------------------------------------------------
echo "=== Cum eval neural-mlpv3-detregime-seed7 @ prod regime starting $(date -u +%H:%M:%SZ) ==="
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=neural-mlpv3-detregime-seed7 \
  npx tsx scripts/evaluate-structural.ts \
    --budget-ms=6000 --node-budget=400 --pool-size=1 \
    2>&1 | tee "${LOG_DIR}/cum-eval-prod-neural-mlpv3-detregime-seed7.log"

# -----------------------------------------------------------------------------
# Step 2: Bonus — F1 seed 7 weights @ det regime (eval-side regime test)
# Tests "do F1 production-trained weights generalize to det eval?"
# -----------------------------------------------------------------------------
echo "=== Bonus F1 seed 7 cum-eval @ det regime starting $(date -u +%H:%M:%SZ) ==="
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=neural-mlpv3-gate-seed7 \
  npx tsx scripts/evaluate-structural.ts \
    --budget-ms=30000 --node-budget=400 --pool-size=1 \
    2>&1 | tee "${LOG_DIR}/cum-eval-det-f1seed7.log"

# -----------------------------------------------------------------------------
# Step 3-4: α — Linear v3 multi-seed (sd 7 and sd 11) at production regime
# Validate F1 sd42 linear v3 = 18 cum matched isn't single-seed unlucky.
# -----------------------------------------------------------------------------
for seed in 7 11; do
  STEP_START=$(date -u +%H:%M:%SZ)
  echo "=== α Linear v3 seed=${seed} starting ${STEP_START} ==="
  SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural.ts \
    --fixtures=branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener \
    --arch=linear --seed=${seed} --generations=30 --mu=5 --lambda=10 \
    --budget-ms=6000 --node-budget=400 --init-std=0.1 \
    --basename=neural-linearv3-seed${seed} \
    2>&1 | tee "${LOG_DIR}/linear-v3-seed${seed}.log"
  echo "=== α Linear v3 seed=${seed} done $(date -u +%H:%M:%SZ) ==="
done

# -----------------------------------------------------------------------------
# Step 5: Cum eval × 2 new linear v3 weights @ production regime
# -----------------------------------------------------------------------------
for w in neural-linearv3-seed7 neural-linearv3-seed11; do
  echo "=== Cum eval ${w} @ prod regime starting $(date -u +%H:%M:%SZ) ==="
  SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=${w} \
    npx tsx scripts/evaluate-structural.ts \
      --budget-ms=6000 --node-budget=400 --pool-size=1 \
      2>&1 | tee "${LOG_DIR}/cum-eval-${w}.log"
done

echo
echo "=== Watchdog + α takeover done $(date -u +%H:%M:%SZ) ==="
echo "Logs in: ${LOG_DIR}"
echo "Weights: data/trained-weights/neural-linearv3-seed{7,11}.json"
