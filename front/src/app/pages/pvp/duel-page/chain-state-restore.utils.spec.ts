import { chainingMsgsToLinkStates } from './chain-state-restore.utils';
import { LOCATION, type ChainingMsg, type Player } from '../duel-ws.types';

/**
 * Unit tests for the shared chainingMsgsToLinkStates helper (F9-bis, 2026-06-04).
 * The helper is the single source of truth for converting the server-side
 * snapshot shape (ChainingMsg[] + negatedIndices) into the ChainLinkState[]
 * the processor stores in `activeChainLinks`. Two consumers depend on it:
 * `duel-connection.ts _handleChainState` (PvP reconnect) and
 * `replay-duel-adapter.ts jumpToState` (replay mid-chain seek).
 */
describe('chainingMsgsToLinkStates', () => {
  const link = (overrides: Partial<ChainingMsg> = {}): ChainingMsg => ({
    type: 'MSG_CHAINING',
    chainIndex: 0,
    cardCode: 100,
    cardName: 'Card 0',
    player: 0 as Player,
    location: LOCATION.SZONE,
    sequence: 0,
    description: 0,
    ...overrides,
  } as ChainingMsg);

  it('returns an empty array for empty input', () => {
    expect(chainingMsgsToLinkStates([], new Set())).toEqual([]);
  });

  it('maps the basic ChainingMsg fields through 1:1', () => {
    const msg = link({ chainIndex: 2, cardCode: 12345, cardName: 'Ash Blossom', player: 1 as Player });
    const [out] = chainingMsgsToLinkStates([msg], new Set());
    expect(out.chainIndex).toBe(2);
    expect(out.cardCode).toBe(12345);
    expect(out.cardName).toBe('Ash Blossom');
    expect(out.player).toBe(1);
  });

  it('computes zoneId via locationToZoneId for field locations', () => {
    const mzone3 = link({ location: LOCATION.MZONE, sequence: 2 });
    const szone1 = link({ location: LOCATION.SZONE, sequence: 0 });
    const [m, s] = chainingMsgsToLinkStates([mzone3, szone1], new Set());
    expect(m.zoneId).toBe('M3');
    expect(s.zoneId).toBe('S1');
  });

  it('returns zoneId=null for non-field locations (HAND, GY, etc.)', () => {
    const fromHand = link({ location: LOCATION.HAND, sequence: 3 });
    const fromGy = link({ location: LOCATION.GRAVE, sequence: 0 });
    const [h, g] = chainingMsgsToLinkStates([fromHand, fromGy], new Set());
    expect(h.zoneId).toBeNull();
    expect(g.zoneId).toBeNull();
    // The original location + sequence must still travel through so a
    // downstream renderer (chain overlay, badge resolver) can still match
    // the link to its origin card.
    expect(h.location).toBe(LOCATION.HAND);
    expect(h.sequence).toBe(3);
  });

  it('always sets resolving=false (caller flips via applyChainSolving)', () => {
    const out = chainingMsgsToLinkStates([link({ chainIndex: 0 }), link({ chainIndex: 1 })], new Set());
    expect(out.every(l => !l.resolving)).toBe(true);
  });

  it('flips negated=true only on links whose chainIndex is in the negated set', () => {
    const links = [link({ chainIndex: 0 }), link({ chainIndex: 1 }), link({ chainIndex: 2 })];
    const out = chainingMsgsToLinkStates(links, new Set([1]));
    expect(out[0].negated).toBe(false);
    expect(out[1].negated).toBe(true);
    expect(out[2].negated).toBe(false);
  });

  it('handles multiple negated indices', () => {
    const links = [link({ chainIndex: 0 }), link({ chainIndex: 1 }), link({ chainIndex: 2 })];
    const out = chainingMsgsToLinkStates(links, new Set([0, 2]));
    expect(out.map(l => l.negated)).toEqual([true, false, true]);
  });

  it('propagates descriptionText when present (drive-by fix for PvP reconnect)', () => {
    // The original `_handleChainState` inline mapping omitted `descriptionText`,
    // so PvP reconnect mid-chain silently lost the resolved effect text. The
    // shared helper now includes it. This test guards against re-omission.
    const msg = link({ descriptionText: 'Send 1 monster to the GY' });
    const [out] = chainingMsgsToLinkStates([msg], new Set());
    expect(out.descriptionText).toBe('Send 1 monster to the GY');
  });

  it('leaves descriptionText undefined when not present on the source message', () => {
    const msg = link({});
    delete msg.descriptionText;
    const [out] = chainingMsgsToLinkStates([msg], new Set());
    expect(out.descriptionText).toBeUndefined();
  });

  it('preserves link order from the input array', () => {
    const msgs = [
      link({ chainIndex: 0, cardName: 'first' }),
      link({ chainIndex: 1, cardName: 'second' }),
      link({ chainIndex: 2, cardName: 'third' }),
    ];
    const out = chainingMsgsToLinkStates(msgs, new Set());
    expect(out.map(l => l.cardName)).toEqual(['first', 'second', 'third']);
  });
});
