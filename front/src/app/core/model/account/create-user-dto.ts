import { LoginDTO } from './login-dto';

export interface CreateUserDTO extends LoginDTO {
  confirmPassword: string | null;
}
