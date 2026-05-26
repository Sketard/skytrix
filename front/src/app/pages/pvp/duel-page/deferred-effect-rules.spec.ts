import { RULES } from './deferred-effect-rules';
import type { RewriterRule } from './deferred-effect-processor';

// =============================================================================
// β.3 cas #12 — Rules table invariants
// -----------------------------------------------------------------------------
// Two invariants live here:
//   - T-V9   garde architecturale A1 — at most one RewriterRule allowed
//           without architecture review (Rule of Three).
//   - T-V10  exactly one RewriterRule is shipped at β.3 cas #12 — guards
//           against a silent revert of `xyzLeaveWithMaterials`.
//   - T-V6   backward-compat: the 5 β.2b ObserverRule have no `onTrigger`
//           nor `onClose` (they are not rewriters by accident).
// =============================================================================

describe('deferred-effect-rules — table invariants', () => {
  describe('β.3 cas #12 — architecture guard A1 (Rule of Three)', () => {
    // -----------------------------------------------------------------------
    // T-V9 — at most one RewriterRule allowed without architecture review.
    // -----------------------------------------------------------------------
    it('T-V9: at most one RewriterRule allowed without architecture review', () => {
      const rewriters = RULES.filter(r => r.kind === 'rewriter');
      expect(rewriters.length).toBeLessThanOrEqual(1);

      if (rewriters.length === 1) {
        // Phase actuelle (β.3) — un seul cas rewriter attendu.
        // Si ce test échoue avec rewriters.length > 1, c'est qu'un 2e
        // RewriterRule a été ajouté sans revue d'archi.
        // → ARRÊT IMMÉDIAT : ouvrir un mémo "Rule of Three triggered"
        //   et décider si on extrait un FlowRewriteProcessor séparé.
        // Cf. ARCHITECTURE GUARD au-dessus de RewriterRule dans
        // `deferred-effect-processor.ts`.
        expect(rewriters[0].kind).toBe('rewriter');
      }
    });

    // -----------------------------------------------------------------------
    // T-V10 — exactly one RewriterRule shipped at β.3 cas #12.
    // -----------------------------------------------------------------------
    it('T-V10: exactly one RewriterRule shipped at β.3 cas #12 (xyz-leave family)', () => {
      const rewriters = RULES.filter(r => r.kind === 'rewriter') as readonly RewriterRule[];
      expect(rewriters.length).toBe(1);
      // The shipped rewriter is the xyz-leave-with-materials family. The
      // name is `xyz-leave:<ref>` — test the prefix via `deriveName`.
      const name = rewriters[0].deriveName(
        { type: 'MSG_MOVE' } as never,
        0,
      );
      expect(name.startsWith('xyz-leave:')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // T-V6 — backward-compat: the 5 β.2b ObserverRule stayed observers (no
  // `onTrigger` and no `onClose` — they would compile as RewriterRule if
  // either was added).
  // -------------------------------------------------------------------------
  describe('β.3 cas #12 — backward-compat of the 5 β.2b ObserverRule', () => {
    it('T-V6: every non-rewriter rule has neither onTrigger nor onClose', () => {
      const observers = RULES.filter(r => r.kind !== 'rewriter');
      // β.2b shipped 5 observers (overlay-show, trigger-show, attack-impact,
      // lp-cost, counter-pulse). β.3 cas #12 added 1 rewriter on top.
      expect(observers.length).toBe(5);
      for (const rule of observers) {
        expect((rule as { onTrigger?: unknown }).onTrigger).toBeUndefined();
        expect((rule as { onClose?: unknown }).onClose).toBeUndefined();
      }
    });
  });
});
