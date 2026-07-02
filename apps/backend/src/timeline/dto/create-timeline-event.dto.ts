import { TimelineEntityType, TimelineEventType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateTimelineEventDto {
  @IsEnum(TimelineEntityType)
  entityType!: TimelineEntityType;

  @IsString()
  @MinLength(1)
  entityId!: string;

  @IsEnum(TimelineEventType)
  type!: TimelineEventType;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(1)
  description!: string;
}
