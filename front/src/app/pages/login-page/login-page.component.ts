import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { UserDTO } from '../../core/model/account/user';
import { Subject } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TypedForm } from '../../core/model/commons/typed-form';
import { LoginDTO } from '../../core/model/account/login-dto';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { CURRENT_USER_KEY } from '../../core/utilities/auth.constants';
import { NotificationService } from '../../core/services/notification.service';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { CreateUserDTO } from '../../core/model/account/create-user-dto';
import { OwnedCardService } from '../../services/owned-card.service';
import { ButtonComponent } from '../../components/button/button.component';

enum LoginMode {
  LOGIN = 'LOGIN',
  CREATE_ACCOUNT = 'CREATE_ACCOUNT',
}

enum AnimationDirection {
  LR = 'LR',
  RL = 'RL',
}

interface ConstellationSlot {
  url: string;
  faceUp: boolean;
}

// Iconic Yu-Gi-Oh passcodes — visually striking staples, all verified
// present in back/images/small/. Curated for the login constellation:
// dragons, Egyptian gods, signature mascots from each anime era.
const ICONIC_POOL: readonly number[] = [
  46986414, 89631139, 33396948, 74677422, 33854624,
  44508094, 62318994, 70903634, 72989439, 84327329,
  78371393, 98502113, 21844576, 87796900, 53183600,
  18036057, 60461804, 76812113, 40640057, 10389142,
  35261759, 53129443, 41462083, 86988864, 90809975,
];

const CONSTELLATION_SLOT_COUNT = 9;
const CARD_BACK_URL = '/assets/images/card_back.jpg';
const cardUrl = (passcode: number): string => `/api/documents/small/code/${passcode}`;

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, MatIcon, TranslatePipe, ButtonComponent],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // L'ambiance "Constellation" du login est sombre par design. `theme-dark`
  // re-déclare les tokens DS sombres pour qu'elle reste intacte sous theme-light.
  host: { class: 'theme-dark' },
})
export class LoginPageComponent implements OnInit, OnDestroy {
  public loginForm: FormGroup<TypedForm<LoginDTO>>;
  public createAccountForm: FormGroup<TypedForm<CreateUserDTO>>;

  public hidePassword = true;
  public modes = LoginMode;
  public mode = signal<LoginMode>(this.modes.LOGIN);

  // Inline submit state — the login page is excluded from the global loader
  // (see loader-interceptor `isSilent`), so the button owns its own spinner.
  public submitting = signal<boolean>(false);

  // ANIMATION
  public directions = AnimationDirection;
  public direction = signal<AnimationDirection>(this.directions.LR);

  // CARD CONSTELLATION — random draw at component construction.
  // 2 to 5 of 9 slots face-up with iconic cards, rest face-down.
  public readonly constellationSlots = signal<ConstellationSlot[]>(this.buildConstellation());

  private readonly unsubscribe$ = new Subject<void>();

  private readonly returnUrl: string | null;

  private readonly notify = inject(NotificationService);

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    public authService: AuthService,
    private readonly ownedCardService: OwnedCardService
  ) {
    const url = this.route.snapshot.queryParams['returnUrl'];
    this.returnUrl = typeof url === 'string' && url.startsWith('/') ? url : null;
    this.loginForm = this.buildLoginForm();
    this.createAccountForm = this.buildCreateAccountForm();
  }

  ngOnInit(): void {
    this.authService.resetLogin();
    this.ownedCardService.resetMap();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  public createAccount(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.authService.createAccount(this.createAccountForm.getRawValue()).subscribe({
      next: () => {
        this.submitting.set(false);
        this.notify.success('success.ACCOUNT_CREATED');
        this.mode.set(LoginMode.LOGIN);
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.notify.error(error);
      },
    });
  }

  public connect(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.authService.login(this.loginForm.getRawValue()).subscribe({
      next: (res: HttpResponse<UserDTO>) => {
        // Keep `submitting` true through navigation — the button stays
        // disabled until the route swap unmounts this component.
        this.authService.setUser(res.body!);
        localStorage.removeItem('accessToken');
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(res.body));
        this.ownedCardService.loadAll();
        if (this.returnUrl) {
          this.router.navigateByUrl(this.returnUrl);
        } else {
          this.router.navigate(['decks']);
        }
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.notify.error(error);
      },
    });
  }

  public changeMode(mode: LoginMode, direction: AnimationDirection): void {
    this.direction.set(direction);
    this.mode.set(mode);
  }

  private buildLoginForm(): FormGroup<TypedForm<LoginDTO>> {
    return new FormGroup<TypedForm<LoginDTO>>({
      pseudo: new FormControl<string | null>(null, Validators.required),
      password: new FormControl<string | null>(null, Validators.required),
    });
  }

  private buildCreateAccountForm(): FormGroup<TypedForm<CreateUserDTO>> {
    return new FormGroup<TypedForm<CreateUserDTO>>(
      {
        pseudo: new FormControl<string | null>(null, Validators.required),
        password: new FormControl<string | null>(null, Validators.required),
        confirmPassword: new FormControl<string | null>(null, Validators.required),
      },
      { validators: this.passwordMatchValidator }
    );
  }

  private readonly passwordMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  };

  // Fisher-Yates partial shuffle: pick N distinct items from a readonly array.
  private pickRandom<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  // Build 9 slots: random 2-5 face-up (random iconic passcodes), rest face-down.
  private buildConstellation(): ConstellationSlot[] {
    const faceUpCount = 2 + Math.floor(Math.random() * 4); // 2..5 inclusive
    const slotIndices = Array.from({ length: CONSTELLATION_SLOT_COUNT }, (_, i) => i);
    const faceUpSlots = new Set(this.pickRandom(slotIndices, faceUpCount));
    const drawnCards = this.pickRandom(ICONIC_POOL, faceUpCount);
    let cursor = 0;
    return slotIndices.map((i) => {
      if (faceUpSlots.has(i)) {
        return { url: cardUrl(drawnCards[cursor++]), faceUp: true };
      }
      return { url: CARD_BACK_URL, faceUp: false };
    });
  }
}
