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

// Thrown when the provider answered correctly but had no images for the
// product. It is not a failure: the engine records it as `empty` so the audit
// tells "the provider was asked and had nothing" apart from "the call failed".
export class NoImagesError extends ProviderError {}

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
  userId?: number;
  // Correlation id of the autocomplete request that triggered the search, so
  // the provider logs stay linked with the rest of the exchange.
  requestId?: string;
  // Absolute deadline (epoch ms) of the exchange this search belongs to. When
  // it passes, the engine stops asking more providers and returns the images
  // it already gathered, so a slow provider can never delay the answer of the
  // caller (the browser waits for the provider timeout and nothing else).
  deadline?: number;
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

// The search port the core consumes. Bound to the engine in app.ts so the core
// never imports the concrete engine or the database.
export type ImageSearcher = (request: ImageSearchRequest) => Promise<ImageSearchOutcome>;

// Persistence view of one provider row the engine needs, decoupled from the
// database shape. A repository maps its stored rows to this record.
export interface ImageProviderRecord {
  slug: string;
  enabled: boolean;
  // Parsed credentials/options (api_key, max_calls_per_month, extras...).
  config: Record<string, string>;
  billingCycleDay: number | null;
  callsThisCycle: number;
  cycleStart: string | null;
}

// Everything the scheduler persists: the provider rows, the round-robin cursor
// and the billing counter. Injected so the core never imports auth/database.
export interface ImageProviderRepository {
  list(): ImageProviderRecord[];
  getLastCalled(): string | null;
  // Atomically reserves one call: stores the new billing counter/cycle and
  // moves the round-robin cursor to the provider in a single persistence, so a
  // search running in parallel can never see the cursor and the counter out of
  // sync.
  reserve(slug: string, callsThisCycle: number, cycleStart: string | null): void;
  recordAttempts(request: ImageSearchRequest, attempts: EngineAttempt[]): void;
}

// A provider handed out by the round-robin scheduler, with the row it was
// selected from (config and billing data included) so the engine can call it
// without re-reading the database.
export interface ProviderSelection {
  definition: ImageProviderDefinition;
  row: ImageProviderRecord;
}

export type ProviderSelectionReason = 'ok' | 'none_configured' | 'none_enabled' | 'all_exhausted';

// Answer to "which provider do I call?". `skippedByQuota` lists the providers
// the scheduler walked over because their monthly allowance is spent, so the
// engine can keep logging them as quota attempts.
export interface ProviderSelectionResult {
  selection: ProviderSelection | null;
  skippedByQuota: string[];
  reason: ProviderSelectionReason;
}

// Centralised round-robin port. The engine only asks "who do I call next?";
// the scheduler owns the cursor, the billing quota and the feeds lookup.
export interface ImageProviderScheduler {
  getFeeds(): ProviderSelection | null;
  nextProvider(): ProviderSelectionResult;
  recordAttempts(request: ImageSearchRequest, attempts: EngineAttempt[]): void;
}

// How one provider behaved during one product search (traceability log line
// and super admin insight).
export interface EngineAttempt {
  slug: string;
  status: 'ok' | 'empty' | 'error' | 'quota';
  requested?: number;
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