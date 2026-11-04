export type AdminRole = 'super_admin' | 'operator' | 'auditor';
export type AdminStatus = 'active' | 'disabled';

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
  mustChangePassword: boolean;
}

export interface AdministratorRecord extends AdminPrincipal {
  status: AdminStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdminCredential {
  principal: AdminPrincipal;
  passwordHash: string;
  status: AdminStatus;
}
