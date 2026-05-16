export interface ModelDefinition {
  id: string;
  name: string;
}

export const ALLOWED_MODELS: ModelDefinition[] = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'deepseek-v4-flash', name: 'Deepseek V4 Flash' },
];

export const DEFAULT_MODEL = ALLOWED_MODELS[0].id;

export function isValidModel(model: string): boolean {
  return ALLOWED_MODELS.some((m) => m.id === model);
}
