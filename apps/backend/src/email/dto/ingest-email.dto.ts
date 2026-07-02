import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

class IngestAttachmentDto {
  @IsString()
  filename!: string;

  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(0)
  size!: number;

  @IsString()
  storageKey!: string;
}

export class IngestEmailDto {
  @IsString()
  accountEmail!: string;

  @IsString()
  @MinLength(1)
  messageId!: string;

  @IsEmail()
  fromAddress!: string;

  @IsOptional()
  @IsString()
  fromName?: string;

  @IsArray()
  @ArrayMinSize(0)
  @IsEmail({}, { each: true })
  toAddresses!: string[];

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  textBody?: string;

  @IsOptional()
  @IsString()
  htmlBody?: string;

  @IsDateString()
  sentAt!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestAttachmentDto)
  attachments?: IngestAttachmentDto[];
}
