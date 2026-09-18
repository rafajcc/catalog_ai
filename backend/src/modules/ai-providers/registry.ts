// Registry of the AI providers: static metadata plus the factory that builds
// each provider class. The suggester resolves the active provider here, so
// switching provider never touches the orchestration code.

import { AIConfig, AIProviderName } from '../../types';
import { AIProvider, AIProviderDefinition } from './types';
import { AnthropicAIProvider } from './providers/anthropic';
import { MockAIProvider } from './providers/mock';
import { OpenaiAIProvider } from './providers/openai';
import { OpenrouterAIProvider } from './providers/openrouter';
import { AI_PROVIDER_DEFAULT_URLS, getAIProviderBaseUrl } from './utils';

// Ordered alphabetically (like the UI selector). The mock provider needs no
// credentials; every other provider talks to its well-known endpoint.
const AI_PROVIDER_DEFINITIONS: AIProviderDefinition[] = [
  {
    slug: 'anthropic',
    name: 'Anthropic',
    auth_kind: 'api_key',
    implemented: true,
    defaultBaseUrl: AI_PROVIDER_DEFAULT_URLS.anthropic,
    create: (config) => new AnthropicAIProvider(config)
  },
  {
    slug: 'mock',
    name: 'Mock',
    auth_kind: 'none',
    implemented: true,
    defaultBaseUrl: AI_PROVIDER_DEFAULT_URLS.mock,
    create: (config) => new MockAIProvider(config)
  },
  {
    slug: 'openai',
    name: 'OpenAI',
    auth_kind: 'api_key',
    implemented: true,
    defaultBaseUrl: AI_PROVIDER_DEFAULT_URLS.openai,
    create: (config) => new OpenaiAIProvider(config)
  },
  {
    slug: 'openrouter',
    name: 'OpenRouter',
    auth_kind: 'api_key',
    implemented: true,
    defaultBaseUrl: AI_PROVIDER_DEFAULT_URLS.openrouter,
    create: (config) => new OpenrouterAIProvider(config)
  }
];

export const AI_PROVIDER_REGISTRY: ReadonlyArray<AIProviderDefinition> = AI_PROVIDER_DEFINITIONS;

export function getAIProviderDefinition(slug: string): AIProviderDefinition | undefined {
  return AI_PROVIDER_DEFINITIONS.find((definition) => definition.slug === slug);
}

// Builds the provider class for the given config. Throws when the provider is
// unknown or listed but not implemented yet.
export function createAIProvider(config: AIConfig): AIProvider {
  const definition = getAIProviderDefinition(config.provider);
  if (!definition || !definition.implemented) {
    throw new Error(`Proveedor de IA desconocido o no implementado: ${config.provider}`);
  }
  return definition.create(config);
}