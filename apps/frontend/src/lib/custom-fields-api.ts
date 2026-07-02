import type { CustomField, CustomFieldEntityType, CustomFieldType, CustomFieldValue } from "@opencrm/shared-types";
import { api } from "./api";

export interface CustomFieldInput {
  entityType: CustomFieldEntityType;
  sectionName?: string;
  fieldName?: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  options?: string[];
  isRequired?: boolean;
  isVisible?: boolean;
  isSearchable?: boolean;
  isFilterable?: boolean;
  sortOrder?: number;
}

export async function listCustomFields(entityType: CustomFieldEntityType) {
  const { data } = await api.get<CustomField[]>("/custom-fields", { params: { entityType } });
  return data;
}

export async function createCustomField(input: CustomFieldInput) {
  const { data } = await api.post<CustomField>("/custom-fields", input);
  return data;
}

export async function updateCustomField(id: string, input: Partial<Omit<CustomFieldInput, "entityType">>) {
  const { data } = await api.patch<CustomField>(`/custom-fields/${id}`, input);
  return data;
}

export async function deleteCustomField(id: string) {
  await api.delete(`/custom-fields/${id}`);
}

export async function getCustomFieldValues(entityType: CustomFieldEntityType, entityId: string) {
  const { data } = await api.get<CustomFieldValue[]>("/custom-fields/values", {
    params: { entityType, entityId },
  });
  return data;
}

export async function saveCustomFieldValues(
  entityType: CustomFieldEntityType,
  entityId: string,
  values: CustomFieldValue[],
) {
  const { data } = await api.post<CustomFieldValue[]>("/custom-fields/values", { entityType, entityId, values });
  return data;
}
