import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from "class-validator";

class StageOrderDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderStagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StageOrderDto)
  stages!: StageOrderDto[];
}
