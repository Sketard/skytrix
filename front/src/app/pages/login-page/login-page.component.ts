import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core';
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
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ToastrService } from 'ngx-toastr';
import { TypedForm } from '../../core/model/commons/typed-form';
import { LoginDTO } from '../../core/model/account/login-dto';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ACCESS_TOKEN, AUTH_HEADER, BEARER_PREFIX, CURRENT_USER_KEY } from '../../core/utilities/auth.constants';
import { displayErrorToastr, displaySuccessToastr } from '../../core/utilities/functions';
import { MatCard } from '@angular/material/card';
import { NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { MatFormField, MatSuffix } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput, MatLabel } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { CreateUserDTO } from '../../core/model/account/create-user-dto';

enum LoginMode {
  LOGIN = 'LOGIN',
  CREATE_ACCOUNT = 'CREATE_ACCOUNT',
}

enum AnimationDirection {
  LR = 'LR',
  RL = 'RL',
}

@Component({
  selector: 'app-login-page',
  imports: [
    MatCard,
    NgSwitch,
    NgSwitchCase,
    ReactiveFormsModule,
    MatFormField,
    MatIcon,
    MatInput,
    MatLabel,
    MatSuffix,
    MatButton,
    NgIf,
  ],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPageComponent implements OnInit, OnDestroy {
  public loginForm: FormGroup<TypedForm<LoginDTO>>;
  public createAccountForm: FormGroup<TypedForm<CreateUserDTO>>;

  public hidePassword = true;
  public modes = LoginMode;
  public mode = signal<LoginMode>(this.modes.LOGIN);

  // ANIMATION
  public directions = AnimationDirection;
  public direction = signal<AnimationDirection>(this.directions.LR);

  private readonly unsubscribe$ = new Subject<void>();

  constructor(
    private readonly router: Router,
    public authService: AuthService,
    private readonly toastr: ToastrService
  ) {
    this.loginForm = this.buildLoginForm();
    this.createAccountForm = this.buildCreateAccountForm();
  }

  ngOnInit(): void {
    this.authService.resetLogin();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  public createAccount(): void {
    this.authService.createAccount(this.createAccountForm.getRawValue()).subscribe({
      next: () => {
        displaySuccessToastr(this.toastr, 'Compte créer avec succès');
        this.mode.set(LoginMode.LOGIN);
      },
      error: (error: HttpErrorResponse) => displayErrorToastr(this.toastr, error),
    });
  }

  public connect(): void {
    this.authService.login(this.loginForm.getRawValue()).subscribe({
      next: (res: HttpResponse<UserDTO>) => {
        res.headers.keys();
        const accessToken = res.headers.get(AUTH_HEADER)?.replace(BEARER_PREFIX, '')!;
        this.authService.setUser(res.body!);
        console.log(this.authService.user());
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(res.body));
        localStorage.setItem(ACCESS_TOKEN, accessToken);
        this.authFinished(res);
      },
      error: (error: HttpErrorResponse) => displayErrorToastr(this.toastr, error),
    });
  }

  private authFinished(res: HttpResponse<UserDTO | void>): void {
    res.headers.keys();
    const accessToken = res.headers.get(AUTH_HEADER)?.replace(BEARER_PREFIX, '');
    if (accessToken) {
      localStorage.setItem(ACCESS_TOKEN, accessToken);
      this.router.navigate(['search']);
    }
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
}
