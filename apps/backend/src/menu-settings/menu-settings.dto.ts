import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested } from "class-validator";

/** Ids de itens e grupos: definidos pelo frontend (ex.: "core:tasks", "work-item-type:VISITA", "group:k3j2"). */
export const MENU_ENTRY_ID = /^[A-Za-z0-9:_-]{1,120}$/;
export const MENU_MAX_ENTRIES = 200;

/**
 * Uma entrada do menu principal, pela ordem em que aparece: um item (que o Administrador pode renomear ou ocultar) ou
 * um cabeçalho de grupo (os itens a seguir ficam nesse grupo, até ao próximo cabeçalho).
 */
export class MenuEntryDto {
  @IsIn(["item", "group"])
  type!: "item" | "group";

  @IsString()
  @Matches(MENU_ENTRY_ID, { message: "id inválido (letras, números, «:», «-» e «_», até 120 caracteres)" })
  id!: string;

  /** Nome a mostrar (num item, substitui o nome por omissão; num grupo, obrigatório). */
  @ValidateIf((entry: MenuEntryDto) => entry.type === "group" || entry.label !== undefined)
  @IsString()
  @Matches(/\S/, { message: "O nome não pode estar vazio" })
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}

export class UpdateMenuSettingsDto {
  @IsArray()
  @ArrayMaxSize(MENU_MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => MenuEntryDto)
  entries!: MenuEntryDto[];
}
