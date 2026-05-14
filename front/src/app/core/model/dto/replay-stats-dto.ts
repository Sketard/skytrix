// =============================================================================
// Replay stats — aggregate counts for the current authenticated user.
// Mirrors back/src/main/java/com/skytrix/model/dto/replay/ReplayStatsDTO.java
// (record fields: total / victories / defeats / draws / winrate).
//
// Source endpoint: GET /api/replays/stats (B2 shipped 2026-05-14).
// =============================================================================

export interface ReplayStatsDTO {
  total: number;
  victories: number;
  defeats: number;
  draws: number;
  winrate: number; // 0..1 (front formats as percent)
}
