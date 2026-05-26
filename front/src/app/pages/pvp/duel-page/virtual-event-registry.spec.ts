import { isVirtual, tagAsVirtual } from './virtual-event-registry';

describe('virtual-event-registry (β.3 cas #12)', () => {
  it('tagAsVirtual marks the event so isVirtual returns true', () => {
    const event = { type: 'MSG_MOVE', cardCode: 42 };
    expect(isVirtual(event)).toBe(false);
    const returned = tagAsVirtual(event);
    expect(returned).toBe(event);
    expect(isVirtual(event)).toBe(true);
  });

  it('isVirtual returns false for any non-tagged event', () => {
    const a = { type: 'MSG_MOVE' };
    const b = { type: 'MSG_DRAW' };
    expect(isVirtual(a)).toBe(false);
    expect(isVirtual(b)).toBe(false);
  });
});
