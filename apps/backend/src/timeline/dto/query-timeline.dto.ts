import { TimelineEntityType } from "@prisma/client";
import { IsEnum, IsString, MinLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Histórico de um registo, paginado (mais recente primeiro). */
export class QueryTimelineDto extends PageQueryDto {
  @IsEnum(TimelineEntityType)
  entityType!: TimelineEntityType;

  @IsString()
  @MinLength(1)
  entityId!: string;
}
