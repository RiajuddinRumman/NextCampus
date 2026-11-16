import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { toLowerCase } from '../../../common/validators/lowercase-transform';

/** The one password rule: 8 characters, no composition requirements. */
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_RULES = {
  minLength: MIN_PASSWORD_LENGTH,
  message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
};

/**
 * Body of `POST /api/auth/sign-up`: an address and nothing else. The account is
 * made by `POST /api/auth/complete-registration`, once the mailbox proves it can
 * receive mail, so this body cannot choose a password for somebody else's roll
 * number.
 *
 * `role` and `status` are deliberately absent: they are set only by the seed, an
 * admin, or moderation, and the validation pipe rejects an unknown field outright,
 * so nobody can promote themselves at sign-up.
 *
 * `email` is validated as a shape only; whether it is an institutional address is
 * decided by `isInstitutionEmail()` in `AuthService.signUp`, because `AuthzGuard`
 * applies the same rule to existing accounts on every student route.
 */
export class SignUpDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;
}

/**
 * Body of `POST /api/auth/complete-registration` — the second half of sign-up,
 * carried by the link in the mailbox.
 *
 * The address is not in this body: it comes out of the token, so the student can
 * only claim the mailbox they were able to open. `name` and `department` live here
 * rather than at sign-up so a pre-registration attempt leaves nothing behind.
 */
export class CompleteRegistrationDto {
  @IsString()
  @MinLength(8)
  token!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })
  @MaxLength(128)
  password!: string;

  // `institution` is not a field a caller can send: the address they verified
  // says which institution they belong to, and there is only one of those.
  @IsOptional()
  @IsString()
  @Length(2, 120)
  department?: string;
}

/** Body of `POST /api/auth/sign-in`. */
export class SignInDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;

  // Not length-checked: a wrong password and an empty one must fail identically.
  @IsString()
  @MinLength(1)
  password!: string;
}

/**
 * Body shared by `resend-verification` and `forgot-password`: both routes need
 * an address and nothing else, and both answer the same neutral sentence.
 */
export class ForgotPasswordDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;
}

/** Body of `POST /api/auth/reset-password`. */
export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })
  @MaxLength(128)
  password!: string;
}

/** Body of `POST /api/auth/change-password`, which requires an active session. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })
  @MaxLength(128)
  newPassword!: string;
}
