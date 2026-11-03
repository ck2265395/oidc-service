import type { DeveloperEmailCodePurpose } from '../../../developer-email-code.js';

export class EmailCodeDto {
  email = '';
  purpose: DeveloperEmailCodePurpose = 'register';
}
