import { Role } from "@prisma/client";
import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  /** Password inicial, definida pelo Administrador. Mínimo 8 caracteres (igual à recuperação de password). */
  @IsString()
  @MinLength(8)
  password!: string;
}
