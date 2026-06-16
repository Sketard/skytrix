import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { PvpZoneBrowserOverlayComponent } from './pvp-zone-browser-overlay.component';
import { DuelCardArtService } from '../duel-card-art.service';
import { CardOnField, POSITION } from '../../duel-ws.types';

function makeCard(overrides: Partial<CardOnField> = {}): CardOnField {
  return {
    cardCode: 11111,
    name: 'Card',
    position: POSITION.FACEUP_ATTACK,
    overlayMaterials: [],
    counters: {},
    ...overrides,
  };
}

describe('PvpZoneBrowserOverlayComponent — Direction B gesture split (2026-06-05)', () => {
  let fixture: ComponentFixture<PvpZoneBrowserOverlayComponent>;
  let component: PvpZoneBrowserOverlayComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PvpZoneBrowserOverlayComponent, TranslateModule.forRoot()],
      providers: [{ provide: DuelCardArtService, useValue: { resolveUrl: () => '' } }],
    });
    fixture = TestBed.createComponent(PvpZoneBrowserOverlayComponent);
    fixture.componentRef.setInput('zoneId', 'GY');
    fixture.componentRef.setInput('cards', [makeCard({ cardCode: 100 }), makeCard({ cardCode: 200 })]);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('onCardClick emits cardClick with cardCode + sequence (= index) + element', () => {
    const events: Array<{ cardCode: number; sequence: number; element: HTMLElement }> = [];
    component.cardClick.subscribe(e => events.push(e));
    const target = document.createElement('button');
    component.onCardClick(makeCard({ cardCode: 100 }), 0, { currentTarget: target } as unknown as MouseEvent);
    expect(events.length).toBe(1);
    expect(events[0].cardCode).toBe(100);
    expect(events[0].sequence).toBe(0);
    expect(events[0].element).toBe(target);
  });

  it('onCardClick does NOT emit inspectCard', () => {
    let inspectEmitted = false;
    component.inspectCard.subscribe(() => { inspectEmitted = true; });
    component.onCardClick(makeCard({ cardCode: 100 }), 1, { currentTarget: document.createElement('button') } as unknown as MouseEvent);
    expect(inspectEmitted).toBeFalse();
  });

  it('onCardContextMenu preventDefaults + stopPropagation + emits inspectCard', () => {
    const events: number[] = [];
    component.inspectCard.subscribe(e => events.push(e));
    let prevented = false;
    let stopped = false;
    const ev = {
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
    } as unknown as MouseEvent;
    component.onCardContextMenu(makeCard({ cardCode: 333 }), ev);
    expect(prevented).toBeTrue();
    expect(stopped).toBeTrue();
    expect(events).toEqual([333]);
  });

  it('onCardLongPress emits inspectCard', () => {
    const events: number[] = [];
    component.inspectCard.subscribe(e => events.push(e));
    component.onCardLongPress(makeCard({ cardCode: 444 }));
    expect(events).toEqual([444]);
  });

  it('renders the XYZ pseudo-zone with its short label + card count', () => {
    fixture.componentRef.setInput('zoneId', 'XYZ');
    fixture.componentRef.setInput('cards', [makeCard({ cardCode: 100 }), makeCard({ cardCode: 200 })]);
    fixture.detectChanges();
    expect(component.zoneLabel).toBe('XYZ');
    const title = fixture.nativeElement.querySelector('.zone-browser__title');
    expect(title.textContent).toContain('XYZ (2)');
  });

  it('face-down card (no cardCode) is a no-op on every handler', () => {
    let any = false;
    component.cardClick.subscribe(() => { any = true; });
    component.inspectCard.subscribe(() => { any = true; });
    const facedown = makeCard({ cardCode: null });
    component.onCardClick(facedown, 0, { currentTarget: document.createElement('button') } as unknown as MouseEvent);
    component.onCardContextMenu(facedown, { preventDefault: () => undefined, stopPropagation: () => undefined } as unknown as MouseEvent);
    component.onCardLongPress(facedown);
    expect(any).toBeFalse();
  });
});
