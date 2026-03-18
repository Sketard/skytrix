export type Role = 'USER' | 'ADMIN';

export type UserDTO = {
  id: number;
  pseudo: string;
  role: Role;
};
