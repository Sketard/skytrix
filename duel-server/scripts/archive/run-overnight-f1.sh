#!/usr/bin/env bash
# =============================================================================
# Path 1.5 Fenêtre 1 (overnight, ~8h) — pre-flight gate v3 + linear v3 ablation
#
# Sequential pipeline. set -e: stops on any failure (partial data preserved).
# Each step writes to its own log file under data/training-logs/path-1.5-overnight-<ISO>/
#
# Args used per train-neural.ts run:
#   - 4 fixtures: branded-dracotail, ryzeal-mitsurugi, snake-eye-yummy, ddd-pendulum
#   - 30 generations, μ=5, λ=10
#   - budget-ms=6000, node-budget=400 (canonical eval regime, biased by CPU noise
#     per determinism investigation but kept for apples-to-apples vs Day 1.5)
#   - --init-std=0.1 (gaussian init, breaks ReLU saturation; required for MLP)
#   - SOLVER_DISABLE_EXPERTISE=1 (honest baseline regime, no archetype expertise)
#
# Pipeline steps:
#   1. Gate v3 seed 42  (~1h 46min)  →  weights neural-mlpv3-gate-seed42.json
#   2. Gate v3 seed 7   (~1h 46min)  →  weights neural-mlpv3-gate-seed7.json
#   3. Gate v3 seed 11  (~1h 46min)  →  weights neural-mlpv3-gate-seed11.json
#   4. Linear v3 ablation seed 42 (~1h 46min) → neural-linearv3-ablation-seed42.json
#   5. 14-fix cum eval × 4 weights (~5min each) → cum eval logs per config
#
# Total ~7h 49min sequential.
#
# Usage: ./scripts/run-overnight-f1.sh
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ISO=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR="data/training-logs/path-1.5-overnight-${ISO}"
mkdir -p "$LOG_DIR"

FIXTURES="branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener"
COMMON_TRAIN_FLAGS="--fixtures=${FIXTURES} --generations=30 --mu=5 --lambda=10 --budget-ms=6000 --node-budget=400 --init-std=0.1"

echo "=== Path 1.5 F1 pipeline starting $(date -u +%H:%M:%SZ) ==="
echo "Logs → ${LOG_DIR}"
echo

# -----------------------------------------------------------------------------
# Step 1-3: Gate v3 — 3 seeds × MLP[32] × 30 gen × 4 fix
# -----------------------------------------------------------------------------
for seed in 42 7 11; do
  STEP_START=$(date -u +%H:%M:%SZ)
  echo "=== Step gate seed=${seed} starting ${STEP_START} ==="
  SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural.ts \
    --arch=mlp:32 --seed=${seed} \
    ${COMMON_TRAIN_FLAGS} \
    --basename=neural-mlpv3-gate-seed${seed} \
    2>&1 | tee "${LOG_DIR}/gate-seed${seed}.log"
  echo "=== gate seed=${seed} done $(date -u +%H:%M:%SZ) ==="
done

# -----------------------------------------------------------------------------
# Step 4: Linear v3 ablation — 1 seed × linear arch × 30 gen × 4 fix
# -----------------------------------------------------------------------------
echo "=== Step linear v3 ablation seed=42 starting $(date -u +%H:%M:%SZ) ==="
SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural.ts \
  --arch=linear --seed=42 \
  ${COMMON_TRAIN_FLAGS} \
  --basename=neural-linearv3-ablation-seed42 \
  2>&1 | tee "${LOG_DIR}/linear-ablation-seed42.log"
echo "=== linear v3 ablation done $(date -u +%H:%M:%SZ) ==="

# -----------------------------------------------------------------------------
# Step 5: 14-fix cum eval × 4 weights
# -----------------------------------------------------------------------------
for w in neural-mlpv3-gate-seed42 neural-mlpv3-gate-seed7 neural-mlpv3-gate-seed11 neural-linearv3-ablation-seed42; do
  echo "=== Step cum-eval ${w} starting $(date -u +%H:%M:%SZ) ==="
  SOLVER_DISABLE_EXPERTISE=1 SOLVER_USE_NEURAL_WEIGHTS=1 SOLVER_NEURAL_WEIGHTS_FILE=${w} \
    npx tsx scripts/evaluate-structural.ts \
      --budget-ms=6000 --node-budget=400 --pool-size=1 \
      2>&1 | tee "${LOG_DIR}/cum-eval-${w}.log"
  echo "=== cum-eval ${w} done $(date -u +%H:%M:%SZ) ==="
done

echo
echo "=== Path 1.5 F1 pipeline done $(date -u +%H:%M:%SZ) ==="
echo "Logs in: ${LOG_DIR}"
echo "Weights: data/trained-weights/{neural-mlpv3-gate-seed{42,7,11},neural-linearv3-ablation-seed42}.json"
