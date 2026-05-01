#!/usr/bin/env bash
# =============================================================================
# Path 1.5 Fenêtre 2 (overnight, ~7-7.5h) — determinism regime validation
#
# Plan Epsilon: validate F1 +7 matched lift is robust to CPU-noise. Trains
# at deterministic regime (budget-ms=30000, nb=400), evaluates at production
# regime (budget-ms=6000, nb=400) for direct comparison with F1 numbers.
#
# Steps:
#   1. Det train seed 7  × 30 gen × 4 fix at budget-ms=30000 (~3-3.5h)
#   2. Det train seed 42 × 30 gen × 4 fix at budget-ms=30000 (~3-3.5h)
#   3. Cum eval × 2 new weights at production regime (~10min)
#   4. Bonus: F1 seed 7 weights cum-eval at det regime (eval-side test, ~10min)
#
# Total ~7-7.5h sequential.
#
# Determinism rationale (from sequences-feasibility-audit + parallel session
# investigation): budget-ms=6000 is wall-clock-bound on most fixtures, causing
# CPU-load-dependent node throughput variance (15.4% nodes span on snake-eye-yummy
# 5x consec runs). budget-ms=30000 lets DFS reach nb=400 deterministically on
# fixtures that would otherwise be wall-bound. Same nb cap, less wall pressure.
#
# Usage: ./scripts/run-overnight-f2.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ISO=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR="data/training-logs/path-1.5-overnight-f2-${ISO}"
mkdir -p "$LOG_DIR"

FIXTURES="branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener"
COMMON_TRAIN_FLAGS="--fixtures=${FIXTURES} --arch=mlp:32 --generations=30 --mu=5 --lambda=10 --node-budget=400 --init-std=0.1"

echo "=== Path 1.5 F2 (Plan Epsilon) starting $(date -u +%H:%M:%SZ) ==="
echo "Logs → ${LOG_DIR}"
echo

# -----------------------------------------------------------------------------
# Step 1-2: Det regime training — 2 seeds × MLP[32] × 30 gen × 4 fix at budget-ms=30000
# -----------------------------------------------------------------------------
for seed in 7 42; do
  STEP_START=$(date -u +%H:%M:%SZ)
  echo "=== Det train seed=${seed} starting ${STEP_START} (budget-ms=30000) ==="
  SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural.ts \
    ${COMMON_TRAIN_FLAGS} \
    --seed=${seed} --budget-ms=30000 \
    --basename=neural-mlpv3-detregime-seed${seed} \
    2>&1 | tee "${LOG_DIR}/det-train-seed${seed}.log"
  echo "=== det train seed=${seed} done $(date -u +%H:%M:%SZ) ==="
done

# -----------------------------------------------------------------------------
# Step 3: Cum eval × 2 new det-trained weights at PRODUCTION regime (budget-ms=6000)
# Direct comparison with F1 cum eval numbers (same regime).
# -----------------------------------------------------------------------------
for w in neural-mlpv3-detregime-seed7 neural-mlpv3-detregime-seed42; do
  echo "=== Cum eval ${w} (production regime) starting $(date -u +%H:%M:%SZ) ==="
  SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=${w} \
    npx tsx scripts/evaluate-structural.ts \
      --budget-ms=6000 --node-budget=400 --pool-size=1 \
      2>&1 | tee "${LOG_DIR}/cum-eval-prod-${w}.log"
  echo "=== cum-eval ${w} done $(date -u +%H:%M:%SZ) ==="
done

# -----------------------------------------------------------------------------
# Step 4: Bonus — F1 seed 7 weights cum-eval at DET regime (eval-side test)
# Tests "do F1 production-trained weights generalize to deterministic eval?"
# -----------------------------------------------------------------------------
echo "=== Bonus F1 seed 7 cum-eval at det regime starting $(date -u +%H:%M:%SZ) ==="
SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=neural-mlpv3-gate-seed7 \
  npx tsx scripts/evaluate-structural.ts \
    --budget-ms=30000 --node-budget=400 --pool-size=1 \
    2>&1 | tee "${LOG_DIR}/cum-eval-det-f1seed7.log"
echo "=== bonus cum-eval done $(date -u +%H:%M:%SZ) ==="

echo
echo "=== Path 1.5 F2 (Plan Epsilon) done $(date -u +%H:%M:%SZ) ==="
echo "Logs in: ${LOG_DIR}"
echo "Weights: data/trained-weights/neural-mlpv3-detregime-seed{7,42}.json"
