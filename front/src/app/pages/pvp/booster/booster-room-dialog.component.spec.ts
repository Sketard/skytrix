import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RoomApiService } from '../room-api.service';
import { BoosterRoomDialogComponent } from './booster-room-dialog.component';

describe('BoosterRoomDialogComponent', () => {
  let fixture: ComponentFixture<BoosterRoomDialogComponent>;
  let component: BoosterRoomDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<BoosterRoomDialogComponent>>;

  beforeEach(async () => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    const roomApi = jasmine.createSpyObj<RoomApiService>('RoomApiService', ['getBoosterSets']);
    roomApi.getBoosterSets.and.returnValue(of([
      { name: 'Legend of Blue Eyes White Dragon', code: 'LOB', cardCount: 126 },
      { name: 'Metal Raiders', code: 'MRD', cardCount: 144 },
    ]));
    await TestBed.configureTestingModule({
      imports: [BoosterRoomDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: RoomApiService, useValue: roomApi },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(BoosterRoomDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lists the sets and filters them by name or code', () => {
    expect(fixture.nativeElement.querySelectorAll('.bd-set').length).toBe(2);
    component.query.set('mrd');
    fixture.detectChanges();
    expect(component.filteredSets().map(s => s.name)).toEqual(['Metal Raiders']);
  });

  it('cannot confirm before a set is chosen', () => {
    component.confirm();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.canConfirm()).toBeFalse();
  });

  it('keeps the minimum Main Deck within what the boosters hold', () => {
    component.minMainDeckSize.set(30);
    for (let i = 0; i < 6; i++) component.stepBoosters(-1); // 10 → 4 boosters = 20 cards
    expect(component.boosterCount()).toBe(4);
    expect(component.minMainDeckSize()).toBe(20);
    component.stepMinMainDeck(5);
    expect(component.minMainDeckSize()).toBe(20);
  });

  it('closes with the chosen settings', () => {
    component.selectSet(component.sets()[1]);
    component.confirm();
    expect(dialogRef.close).toHaveBeenCalledWith({
      boosterSetName: 'Metal Raiders',
      boosterCount: 10,
      minMainDeckSize: 30,
    });
  });
});
