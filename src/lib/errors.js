import { translate } from '../../packages/i18n/index.js';

export class AppError extends Error {
  constructor(code, params = {}, statusCode = 400) {
    super(translate('ru', `errors.${code}`, params));
    this.code = code;
    this.errorKey = `errors.${code}`;
    this.params = params;
    this.statusCode = statusCode;
  }
}

export function localizedError(error, locale) {
  const errorKey = error?.errorKey || 'errors.request_failed';
  return { errorKey, errorParams: error?.params || {}, error: translate(locale, errorKey, error?.params) };
}
