import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { toLowerCase } from '../../../common/validators/lowercase-transform';

const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_RULES = {
  minLength: MIN_PASSWORD_LENGTH,
  message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
};

export class SignUpDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;
}

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

  @IsOptional()
  @IsString()
  @Length(2, 120)
  department?: string;
}
export class SignInDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class ForgotPasswordDto {
  @Transform(toLowerCase)
  @IsEmail()
  email!: string;
}
export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_RULES.minLength, { message: PASSWORD_RULES.message })
  @MaxLength(128)
  newPassword!: string;
}
