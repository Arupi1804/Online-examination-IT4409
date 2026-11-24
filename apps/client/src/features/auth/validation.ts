import { loginFormSchema, registrationFormSchema } from './auth-schema.ts';
import type {
  AuthFieldErrors,
  AuthFormValues,
  AuthMode,
} from './auth-model.ts';

export function validateAuthForm(
  mode: AuthMode,
  values: AuthFormValues,
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const input = {
    name: values.name.trim(),
    email: values.email.trim(),
    password: values.password,
  };
  const schema = mode === 'register' ? registrationFormSchema : loginFormSchema;
  const result = schema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === 'name')
        errors.name = input.name
          ? 'Họ và tên tối đa 100 ký tự.'
          : 'Bạn hãy nhập họ và tên.';
      if (field === 'email')
        errors.email = input.email
          ? issue.code === 'too_big'
            ? 'Email tối đa 254 ký tự.'
            : 'Email chưa đúng định dạng, ví dụ: ban@example.com.'
          : 'Bạn hãy nhập email.';
      if (field === 'password')
        errors.password = input.password
          ? 'Mật khẩu cần từ 8 đến 72 ký tự.'
          : 'Bạn hãy nhập mật khẩu.';
    }
  }
  if (!input.password) errors.password = 'Bạn hãy nhập mật khẩu.';
  if (mode === 'register') {
    if (!values.confirmPassword) {
      errors.confirmPassword = 'Bạn hãy nhập lại mật khẩu.';
    } else if (values.confirmPassword !== values.password) {
      errors.confirmPassword = 'Mật khẩu xác nhận chưa khớp.';
    }
  }
  return errors;
}
