#!/usr/bin/env bash
# =============================================================================
# run-multi-seed-parallel.sh — process-level seed parallelism for ES training.
#
# Launches N independent train-neural.ts processes (one per seed) in parallel
# via shell `&`, waits for all via `wait`. Each process is single-threaded
# (sequential ES, no Piscina), so there's no in-process CPU contention and
# no train-vs-eval regime mismatch.
#
# This is the RECOMMENDED parallelism pattern for Phase B Sprint 3. The
# Piscina-based train-neural-pool.ts is preserved for exploration but has
# a known issue: in-ES parallelism causes CPU thermal throttle during
# training that doesn't hit during single-task re-eval, producing
# fitness/eval mismatch (commit 2026-04-27).
#
# Speedup: ~N× wall-time reduction vs sequential, bound by physical core
# count + thermal envelope. On an 8-core machine, 5 seeds in parallel
# typically completes in ~1.0-1.3× the time of a single-seed run (vs 5×
# sequential).
#
# Outputs go to data/trained-weights/<basename>-seed<N>.json and
# data/training-logs/<basename>-seed<N>-<ISO>/ as usual.
#
# Usage:
#   ./scripts/run-multi-seed-parallel.sh [seeds...] -- [train-neural-args]
#
# Example:
#   ./scripts/run-multi-seed-parallel.sh 42 7 11 -- \
#     --fixtures=branded-dracotail-opener,ryzeal-mitsurugi-opener,snake-eye-yummy-opener,ddd-pendulum-opener \
#     --arch=mlp:32 --generations=30 --mu=5 --lambda=10 \
#     --budget-ms=6000 --node-budget=400 --init-std=0.1 \
#     --basename=neural-mlpv3-multiseed
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# Parse: seeds before `--`, remaining args after `--` are passed to train-neural.ts
SEEDS=()
TRAIN_ARGS=()
ARGS_MODE="seeds"
for arg in "$@"; do
  if [ "$arg" = "--" ]; then
    ARGS_MODE="train"
    continue
  fi
  if [ "$ARGS_MODE" = "seeds" ]; then
    SEEDS+=("$arg")
  else
    TRAIN_ARGS+=("$arg")
  fi
done

if [ ${#SEEDS[@]} -eq 0 ]; then
  echo "Usage: $0 [seeds...] -- [train-neural-args]"
  echo "Example: $0 42 7 11 -- --fixtures=... --arch=mlp:32 --generations=30 ..."
  exit 1
fi

ISO=$(date -u +%Y%m%dT%H%M%SZ)
LOG_DIR="data/training-logs/multi-seed-parallel-${ISO}"
mkdir -p "$LOG_DIR"
echo "=== Multi-seed parallel training starting $(date -u +%H:%M:%SZ) ==="
echo "Seeds: ${SEEDS[*]}"
echo "Train args: ${TRAIN_ARGS[*]}"
echo "Logs → ${LOG_DIR}"
echo

PIDS=()
for seed in "${SEEDS[@]}"; do
  echo "Launching seed=${seed}..."
  SOLVER_DISABLE_EXPERTISE=1 npx tsx scripts/train-neural.ts \
    "${TRAIN_ARGS[@]}" \
    --seed="${seed}" \
    > "${LOG_DIR}/seed-${seed}.log" 2>&1 &
  PIDS+=($!)
done

echo
echo "All ${#SEEDS[@]} processes launched (PIDs: ${PIDS[*]}). Waiting..."
echo

# Wait for all background processes. If any fails, this will exit non-zero
# (because of set -e and `wait` semantics with multiple PIDs).
FAIL=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    echo "PID ${pid} failed"
    FAIL=$((FAIL + 1))
  fi
done

echo
echo "=== Multi-seed parallel done $(date -u +%H:%M:%SZ) ==="
if [ "$FAIL" -gt 0 ]; then
  echo "WARNING: ${FAIL} of ${#SEEDS[@]} processes failed. Check logs in ${LOG_DIR}/"
  exit 1
fi
echo "All ${#SEEDS[@]} seeds completed successfully. Logs in ${LOG_DIR}/"
echo "Re-eval summaries (per-seed):"
for seed in "${SEEDS[@]}"; do
  echo "--- seed=${seed} ---"
  grep -E "re-eval (aggregate|.*opener)" "${LOG_DIR}/seed-${seed}.log" | tail -5 || true
done
