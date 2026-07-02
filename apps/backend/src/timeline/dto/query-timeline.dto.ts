import { TimelineEntityType } from "@prisma/client";
import { IsEnum, IsString, MinLength } from "class-validator";

export class QueryTimelineDto {
  @IsEnum(TimelineEntityType)
  entityType!: TimelineEntityType;

  @IsString()
  @MinLength(1)
  entityId!: string;
}
