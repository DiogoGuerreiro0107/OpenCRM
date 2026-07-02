import { IsString, MinLength } from "class-validator";

export class CreatePipelineDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
