import type { DeveloperEmailCodePurpose } from '../domain/email-code.js';

export class EmailCodeDto {
  email = '';
  purpose: DeveloperEmailCodePurpose = 'register';
}
