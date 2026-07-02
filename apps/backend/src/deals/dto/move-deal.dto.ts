import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class MoveDealDto {
  @IsString()
  stageId!: string;

  @IsInt()
  @Min(0)
  index!: number;

  @IsOptional()
  @IsString()
  lossReason?: string;
}
