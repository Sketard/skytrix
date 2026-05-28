import { RULES, xyzLeaveWithMaterials } from './deferred-effect-rules';
import type { RewriterRule } from './deferred-effect-processor';

// =============================================================================
// β.3 cas #12 — Rules table invariants
// -----------------------------------------------------------------------------
// Four invariants live here:
//   - T-V9   garde architecturale A1 — at most one RewriterRule allowed
//           without architecture review (Rule of Three).
//   - T-V10  exactly one RewriterRule is shipped at β.3 cas #12 — guards
//           against a silent revert of `xyzLeaveWithMaterials` by
//           comparing identity by REFERENCE, not by name prefix.
//   - T-V10b no other rule in the table reuses the `xyz-` family prefix —
//           guards against the bypass "remove the original + add
//           `xyz-leave-followup:N`" which would keep T-V9 + T-V10 green.
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
    // T-V10 — exactly one RewriterRule shipped, identity check by REFERENCE.
    // -----------------------------------------------------------------------
    // Identity by reference (and not by name prefix) défait le bypass
    // "supprimer `xyzLeaveWithMaterials` + ajouter `xyzLeaveFollowupRule`
    // dont `deriveName` produit `xyz-leave:...`" — un nouveau rewriter
    // serait une autre référence et ce test échouerait.
    it('T-V10: the shipped rewriter is xyzLeaveWithMaterials by reference', () => {
      const rewriters = RULES.filter(r => r.kind === 'rewriter') as readonly RewriterRule[];
      expect(rewriters.length).toBe(1);
      expect(rewriters[0]).toBe(xyzLeaveWithMaterials);
    });

    // -----------------------------------------------------------------------
    // T-V10b — no rule reuses the `xyz-` family prefix.
    // -----------------------------------------------------------------------
    // Bouchonne le bypass complémentaire : si quelqu'un ajoute UN second
    // rewriter `xyzLeaveFollowupRule` ET supprime `xyzLeaveWithMaterials`,
    // T-V9 + T-V10b restent verts mais le nom `xyz-leave:...` est libre.
    // Inversement, si quelqu'un ajoute un ObserverRule dont `deriveName`
    // colle `xyz-` en préfixe pour reproduire la sémantique du rewriter
    // dans une catégorie non couverte par le garde, ce test échoue.
    it('T-V10b: no other rule deriveName starts with `xyz-` family prefix', () => {
      const dummyMoveEvent = {
        type: 'MSG_MOVE',
        player: 0,
        cardCode: 0,
        fromLocation: 0,
        toLocation: 0,
      } as never;
      for (const rule of RULES) {
        if (rule === xyzLeaveWithMaterials) continue;
        let name: string;
        try {
          name = rule.deriveName(dummyMoveEvent, 0);
        } catch {
          // deriveName narrows on event type → throws on dummy ; this is
          // expected and means the rule doesn't apply to MSG_MOVE.
          continue;
        }
        expect(name.startsWith('xyz-')).toBe(false);
      }
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
