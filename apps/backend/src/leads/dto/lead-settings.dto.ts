import { IsIn } from "class-validator";
import { LEAD_MODES, LeadMode } from "../lead-mode";

export class LeadSettingsDto {
  @IsIn(LEAD_MODES)
  mode!: LeadMode;
}
