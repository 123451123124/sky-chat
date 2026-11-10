export interface ModelDefinition {
  id: string;
  name: string;
}

export const ALLOWED_MODELS: ModelDefinition[] = [
  { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus' },
  { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash' },
  { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
  { id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash' },
];

export const DEFAULT_MODEL = ALLOWED_MODELS[0].id;
export const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export function isValidModel(model: string): boolean {
  return ALLOWED_MODELS.some((m) => m.id === model);
}
