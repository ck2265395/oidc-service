export interface AdminPrincipal {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

export interface AdminCredential {
  principal: AdminPrincipal;
  passwordHash: string;
  status: 'active' | 'disabled';
}
