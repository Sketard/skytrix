// === Import : NPM
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { ACCESS_TOKEN, AUTH_HEADER, AUTH_HEADER_PREFIX, CURRENT_USER_KEY } from '../core/utilities/auth.constants';
import { LoginDTO } from '../core/model/account/login-dto';
import { UserDTO } from '../core/model/account/user';
import { RefreshStep } from '../core/enums/refresh-step.enum';
import { CreateUserDTO } from '../core/model/account/create-user-dto';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly userState = signal<UserDTO | undefined>(undefined);
  readonly user = this.userState.asReadonly();

  private readonly refreshSubject = new BehaviorSubject(RefreshStep.FINISHED);
  public readonly refresh$ = this.refreshSubject.asObservable();

  constructor(
    private readonly httpClient: HttpClient,
    private readonly router: Router
  ) {}

  public setUser(user: UserDTO) {
    this.userState.set(user);
  }

  get refresh(): RefreshStep {
    return this.refreshSubject.value;
  }

  set refresh(value: RefreshStep) {
    this.refreshSubject.next(value);
  }

  canActivate(): boolean {
    const currentUser = localStorage.getItem(CURRENT_USER_KEY);
    if (currentUser) {
      const isTokenPresent = !!localStorage.getItem(ACCESS_TOKEN);

      if (!isTokenPresent) {
        this.router.navigate(['/login']);
      }
      return isTokenPresent;
    }
    return false;
  }

  public login(form: LoginDTO): Observable<HttpResponse<UserDTO>> {
    return this.httpClient
      .post<UserDTO>(`api/login`, {}, { headers: this.getAuthorizationHeader(form), observe: 'response' })
      .pipe(take(1));
  }

  public logout(): void {
    if (this.isLoggedIn()) {
      this.httpClient.post<void>(`api/logout`, null).pipe(take(1)).subscribe();
      this.resetLogin();
    }
  }

  public resetLogin(): void {
    if (this.isLoggedIn()) {
      this.userState.set(undefined);
      this.clearAuthDatas();
      this.router.navigate(['login']);
    }
  }

  public refreshToken(): Observable<HttpResponse<void>> {
    return this.httpClient.post<void>(`api/refresh`, null, { observe: 'response' }).pipe(take(1));
  }

  public createAccount(form: CreateUserDTO): Observable<void> {
    return this.httpClient.post<void>(`api/create-account`, form).pipe(take(1));
  }

  public clearAuthDatas(): void {
    localStorage.removeItem(ACCESS_TOKEN);
    localStorage.removeItem(CURRENT_USER_KEY);
  }

  public isLoggedIn(): boolean {
    return !!this.user();
  }

  private getAuthorizationHeader(form: LoginDTO): HttpHeaders {
    const headers: HttpHeaders = new HttpHeaders();
    const authHeader = AUTH_HEADER_PREFIX + btoa(`${form.pseudo}:${form.password}`);
    return headers.set(AUTH_HEADER, authHeader);
  }
}
