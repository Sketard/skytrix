import { isAbsorbed, tagAsAbsorbed } from './absorbed-event-registry';

describe('absorbed-event-registry (U16, 2026-06-01)', () => {
  it('tagAsAbsorbed marks the event so isAbsorbed returns true', () => {
    const event = { type: 'MSG_MOVE', cardCode: 42 };
    expect(isAbsorbed(event)).toBe(false);
    const returned = tagAsAbsorbed(event);
    expect(returned).toBe(event);
    expect(isAbsorbed(event)).toBe(true);
  });

  it('isAbsorbed returns false for any non-tagged event', () => {
    const a = { type: 'MSG_MOVE' };
    const b = { type: 'MSG_DRAW' };
    expect(isAbsorbed(a)).toBe(false);
    expect(isAbsorbed(b)).toBe(false);
  });
});
