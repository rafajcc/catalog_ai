// Shared types of the image-provider services.
//
// Product images come from the image provider services configured by the super
// admin, NOT from the AI. Each service is a small class with a single
// `search()` method; the engine (services/engine.ts) runs them with a
// round-robin order, billing-cycle counters and image URL validation.

// How the service authenticates (drives the configuration form of the super
// admin panel). 'none' services need no credentials.
export type ImageProviderAuthKind = 'api_key' | 'user_password' | 'none';

// Error thrown by a provider when it cannot return images for an explainable
// reason (missing key, HTTP error, no results). The message is kept in the
// attempts log and shown to the super admin.
export class ProviderError extends Error {}

// Everything a provider needs to look for images of one product.
export interface ImageSearchRequest {
  brand: string;
  reference: string;
  ean: string;
  // Public origin of this server (scheme://host). Only the mock service uses
  // it, to point its test images back at the deployment instead of localhost.
  origin: string;
  // How many image URLs may be returned at most (1..5, slots still free).
  maxResults: number;
  // Tenant context, kept for the traceability logs.
  comercioId?: number;
  comercioName?: string;
}

// Json-config of a provider row: credentials plus provider-specific extras.
// Empty strings mean "not configured"; max_calls_per_month empty = unlimited.
export interface ProviderConfig {
  api_key?: string;
  username?: string;
  password?: string;
  max_calls_per_month?: string;
  actor_id?: string;
  zone?: string;
  marketplace?: string;
  location_name?: string;
  language_name?: string;
  base_url?: string;
  [key: string]: string | undefined;
}

// A field the super admin can fill for a provider beyond the core api
// key / username / password inputs.
export interface ProviderConfigField {
  key: string;
  label: string;
  placeholder?: string;
}

// Static metadata of a provider: how to show it, configure it and instantiate
// it. Registering a service here is all it takes to make it available.
export interface ImageProviderDefinition {
  slug: string;
  name: string;
  auth_kind: ImageProviderAuthKind;
  // False for services that are listed but not implemented yet: they cannot be
  // enabled or called and the UI marks them as such.
  implemented: boolean;
  // Extra configuration inputs shown in the super admin modal.
  extraConfigFields?: ProviderConfigField[];
  // The feeds service is always tried first (when enabled), before the
  // round-robin order, because it is the cheapest and most reliable source.
  alwaysFirst?: boolean;
  create: (config: ProviderConfig) => ImageProvider;
}

// One image provider service. Fails with ProviderError when it cannot find
// images; returns an array of candidate image URLs otherwise.
export abstract class ImageProvider {
  abstract readonly slug: string;

  constructor(protected readonly config: ProviderConfig) {}

  abstract search(request: ImageSearchRequest): Promise<string[]>;
}

// How one provider behaved during one product search (traceability log line
// and super admin insight).
export interface EngineAttempt {
  slug: string;
  status: 'ok' | 'empty' | 'error' | 'quota';
  urls?: number;
  durationMs?: number;
  error?: string;
}

export interface ImageSearchOutcome {
  urls: string[];
  // Slug of the service that produced the URLs, null when none did. 'feeds'
  // when the URLs come from the super admin feed table.
  source: string | null;
  attempts: EngineAttempt[];
}