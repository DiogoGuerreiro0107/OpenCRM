import { TimelineEventType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateTimelineEventDto {
  @IsOptional()
  @IsEnum(TimelineEventType)
  type?: TimelineEventType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  description?: string;
}
