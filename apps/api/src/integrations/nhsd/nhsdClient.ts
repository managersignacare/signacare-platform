/**
 * NHSD (National Health Services Directory) Client
 *
 * Searches the Australian National Health Services Directory for:
 * - Healthcare services (GP clinics, specialists, hospitals)
 * - Practitioners (GPs, psychiatrists, allied health)
 * - Organisations
 *
 * Consumer API v5: https://developers.nhsd.healthdirect.org.au/docs/consumer-api/
 * FHIR v4:         https://build.fhir.nhsd.healthdirect.org.au/v4/
 *
 * Auth: x-api-key header (apply at developers.nhsd.healthdirect.org.au)
 */

import { logger } from '../../utils/logger';
import { AppError } from '../../shared/errors';
// Audit Tier 7.1 (CRIT-A1) ⚠ BREAKING — see shared/requireEnv.ts.
import { requireEnv, optionalEnv } from '../../shared/requireEnv';

// Both URLs have legitimate public defaults; the API key is mandatory.
const NHSD_API_URL = optionalEnv('NHSD_API_URL') ?? 'https://api.nhsd.healthdirect.org.au';
const NHSD_FHIR_URL = optionalEnv('NHSD_FHIR_URL') ?? 'https://api.fhir.nhsd.healthdirect.org.au/v4';

// ── NHSD Consumer API v5 response shapes ──
// The API returns different field names across versions (camelCase vs
// FHIR-style) — fields are typed as unions of the known variants.
interface NhsdAddress {
  line?: string[];
  street?: string;
  addressLine1?: string;
  suburb?: string;
  city?: string;
  state?: string;
  stateTerritory?: string;
  postcode?: string;
  postalCode?: string;
  formatted?: string;
  text?: string;
}
// NhsdContact covers both the v5 Consumer API shape (telecom) and the
// regional variations with `type`/`purpose`/`contactType`/`number`.
// The extractPhone/Fax/Email helpers accept this full union.
interface NhsdContact {
  type?: string;
  purpose?: string;
  system?: string;
  contactType?: string;
  use?: string;
  value?: string;
  number?: string;
  address?: string;
}
interface NhsdLocation {
  address?: NhsdAddress;
  position?: { latitude: number; longitude: number };
}
interface NhsdPractitioner {
  id?: string;
  name?: { given?: string; family?: string; firstName?: string; lastName?: string };
  firstName?: string;
  lastName?: string;
  providerNumber?: string;
  hpii?: string;
  specialty?: { text?: string };
  specialties?: Array<{ name?: string }>;
  contacts?: NhsdContact[];
  telecom?: NhsdContact[];
}
interface NhsdOrganisation { id?: string; name?: string }
interface NhsdService {
  id?: string;
  name?: string;
  organisation?: NhsdOrganisation;
  organization?: NhsdOrganisation;
  locations?: NhsdLocation[];
  location?: NhsdLocation;
  practitioners?: NhsdPractitioner[];
  contacts?: NhsdContact[];
  telecom?: NhsdContact[];
}
interface NhsdSearchResponse {
  services?: NhsdService[];
  healthcareServices?: NhsdService[];
  results?: NhsdService[];
  meta?: { total?: number };
  totalCount?: number;
}

interface NhsdSearchBody {
  responseControl: {
    limit: number;
    offset: number;
  };
  practitioner?: {
    search?: { name: string };
    filter?: { specialty: { codes: string[] } };
  };
  location?: {
    proximity: {
      near_postcode?: string;
      near_suburb?: { code: string };
      near_distance: number;
    };
  };
  requestContext?: {
    serviceDeliveryMethod: 'PHYSICAL' | 'VIRTUAL' | 'HOME_VISIT';
  };
}

interface NhsdNameLike {
  prefix?: string | string[];
  given?: string | string[];
  firstName?: string;
  family?: string;
  lastName?: string;
}

// FHIR R4 Bundle / PractitionerRole / Practitioner / Organization /
// Location shapes for the NHSD FHIR v4 endpoint. Fields we don't use
// are omitted. All fields are optional because FHIR resources can be
// partial in search responses.
interface FhirTelecom { system?: string; value?: string; use?: string }
interface FhirAddress {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  text?: string;
}
interface FhirHumanName {
  prefix?: string[];
  given?: string[];
  family?: string;
}
interface FhirIdentifier { system?: string; value?: string }
interface FhirPractitioner {
  id?: string;
  name?: FhirHumanName[];
  telecom?: FhirTelecom[];
  identifier?: FhirIdentifier[];
}
interface FhirOrganization {
  id?: string;
  name?: string;
  address?: FhirAddress[];
  telecom?: FhirTelecom[];
}
interface FhirLocation {
  id?: string;
  address?: FhirAddress;
  telecom?: FhirTelecom[];
}
interface FhirPractitionerRole {
  id?: string;
  resourceType?: 'PractitionerRole';
  practitioner?: { reference?: string };
  organization?: { reference?: string };
  location?: Array<{ reference?: string }>;
  specialty?: Array<{ coding?: Array<{ display?: string }> }>;
  telecom?: FhirTelecom[];
}
interface FhirBundleEntry {
  resource?: (FhirPractitioner | FhirOrganization | FhirLocation | FhirPractitionerRole) & { resourceType?: string };
}
interface FhirBundle {
  total?: number;
  entry?: FhirBundleEntry[];
}

export function isNhsdConfigured(): boolean {
  const k = optionalEnv('NHSD_API_KEY');
  return !!k && k.length > 0;
}

export function requireNhsdConfig(): void {
  if (!isNhsdConfigured()) {
    throw new AppError(
      'NHSD integration not configured — set NHSD_API_KEY env var',
      503,
      'INTEGRATION_NOT_CONFIGURED',
    );
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NhsdProviderSearchParams {
  /** Free-text practitioner name search */
  name?: string;
  /** Postcode for proximity search */
  postcode?: string;
  /** Suburb name for proximity search */
  suburb?: string;
  /** SNOMED specialty codes (e.g., GP = '208d00000X') */
  specialtyCodes?: string[];
  /** Service delivery: PHYSICAL, VIRTUAL, HOME_VISIT */
  serviceDeliveryMethod?: 'PHYSICAL' | 'VIRTUAL' | 'HOME_VISIT';
  /** Proximity radius in meters (default 5000) */
  radiusMeters?: number;
  /** Results per page (default 20) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface NhsdProvider {
  id: string;
  name: string;
  givenName?: string;
  familyName?: string;
  practiceName?: string;
  providerNumber?: string;
  specialty?: string;
  phone?: string;
  fax?: string;
  email?: string;
  address: {
    street?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    formatted?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
  };
  serviceId?: string;
  organisationId?: string;
}

export interface NhsdSearchResult {
  providers: NhsdProvider[];
  total: number;
  offset: number;
  limit: number;
  error?: string;
}

// ── Consumer API v5 Search ────────────────────────────────────────────────────

export async function searchProviders(params: NhsdProviderSearchParams): Promise<NhsdSearchResult> {
  if (!isNhsdConfigured()) {
    return { providers: [], total: 0, offset: 0, limit: 0, error: 'NHSD not configured. Set NHSD_API_KEY.' };
  }

  try {
    const searchBody: NhsdSearchBody = {
      responseControl: {
        limit: params.limit ?? 20,
        offset: params.offset ?? 0,
      },
    };

    // Practitioner name search
    if (params.name) {
      searchBody['practitioner'] = {
        search: { name: params.name },
      };
    }

    // Specialty filter
    if (params.specialtyCodes?.length) {
      searchBody['practitioner'] = {
        ...searchBody['practitioner'],
        filter: {
          specialty: { codes: params.specialtyCodes },
        },
      };
    }

    // Location proximity
    if (params.postcode) {
      searchBody['location'] = {
        proximity: {
          near_postcode: params.postcode,
          near_distance: params.radiusMeters ?? 10000,
        },
      };
    } else if (params.suburb) {
      searchBody['location'] = {
        proximity: {
          near_suburb: { code: params.suburb },
          near_distance: params.radiusMeters ?? 10000,
        },
      };
    }

    // Service delivery method
    if (params.serviceDeliveryMethod) {
      searchBody['requestContext'] = {
        serviceDeliveryMethod: params.serviceDeliveryMethod,
      };
    }

    const res = await fetch(`${NHSD_API_URL}/v5/healthcareServices/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': requireEnv('NHSD_API_KEY', 'NHSD Consumer API'),
      },
      body: JSON.stringify(searchBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error({ status: res.status, body: errText.substring(0, 300) }, '[NHSD] Search failed');
      return { providers: [], total: 0, offset: params.offset ?? 0, limit: params.limit ?? 20, error: `NHSD ${res.status}: ${errText.substring(0, 200)}` };
    }

    const data = await res.json() as NhsdSearchResponse;
    const services: NhsdService[] = data.services ?? data.healthcareServices ?? data.results ?? [];

    const providers: NhsdProvider[] = services.flatMap((svc) => {
      const org = svc.organisation ?? svc.organization ?? {};
      const loc = svc.locations?.[0] ?? svc.location ?? {};
      const addr = loc.address ?? {};
      const practitioners = svc.practitioners ?? [];

      if (practitioners.length === 0) {
        // Service-level entry (no individual practitioners listed)
        return [{
          id: svc.id ?? '',
          name: svc.name ?? org.name ?? 'Unknown Service',
          practiceName: org.name ?? svc.name,
          phone: extractPhone(svc.contacts ?? svc.telecom),
          fax: extractFax(svc.contacts ?? svc.telecom),
          email: extractEmail(svc.contacts ?? svc.telecom),
          address: {
            street: addr.line?.join(', ') ?? addr.street ?? addr.addressLine1,
            suburb: addr.suburb ?? addr.city,
            state: addr.state ?? addr.stateTerritory,
            postcode: addr.postcode ?? addr.postalCode,
            formatted: addr.formatted ?? addr.text,
          },
          location: loc.position ? { latitude: loc.position.latitude, longitude: loc.position.longitude } : undefined,
          serviceId: svc.id,
          organisationId: org.id,
        }];
      }

      return practitioners.map((prac) => ({
        id: prac.id ?? `${svc.id}-${prac.name?.family ?? ''}`,
        name: formatName(prac.name),
        givenName: prac.name?.given ?? prac.name?.firstName ?? prac.firstName,
        familyName: prac.name?.family ?? prac.name?.lastName ?? prac.lastName,
        practiceName: org.name ?? svc.name,
        providerNumber: prac.providerNumber ?? prac.hpii,
        specialty: prac.specialty?.text ?? prac.specialties?.[0]?.name,
        phone: extractPhone(svc.contacts ?? svc.telecom) || extractPhone(prac.contacts ?? prac.telecom),
        fax: extractFax(svc.contacts ?? svc.telecom),
        email: extractEmail(svc.contacts ?? svc.telecom) || extractEmail(prac.contacts ?? prac.telecom),
        address: {
          street: addr.line?.join(', ') ?? addr.street ?? addr.addressLine1,
          suburb: addr.suburb ?? addr.city,
          state: addr.state ?? addr.stateTerritory,
          postcode: addr.postcode ?? addr.postalCode,
          formatted: addr.formatted ?? addr.text,
        },
        location: loc.position ? { latitude: loc.position.latitude, longitude: loc.position.longitude } : undefined,
        serviceId: svc.id,
        organisationId: org.id,
      }));
    });

    return {
      providers,
      total: data.meta?.total ?? data.totalCount ?? providers.length,
      offset: params.offset ?? 0,
      limit: params.limit ?? 20,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[NHSD] Network error');
    return { providers: [], total: 0, offset: 0, limit: 20, error: `NHSD error: ${msg}` };
  }
}

// ── FHIR v4 — Practitioner Search ────────────────────────────────────────────

export async function searchPractitionerFhir(name: string, postcode?: string): Promise<NhsdSearchResult> {
  if (!isNhsdConfigured()) {
    return { providers: [], total: 0, offset: 0, limit: 0, error: 'NHSD not configured.' };
  }

  try {
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (postcode) params.set('address-postalcode', postcode);
    params.set('_count', '20');
    params.set('_include', 'PractitionerRole:organization');
    params.set('_include', 'PractitionerRole:location');

    const res = await fetch(`${NHSD_FHIR_URL}/PractitionerRole?${params}`, {
      headers: {
        'Accept': 'application/fhir+json',
        'x-api-key': requireEnv('NHSD_API_KEY', 'NHSD Consumer API'),
      },
    });

    if (!res.ok) {
      return { providers: [], total: 0, offset: 0, limit: 20, error: `NHSD FHIR ${res.status}` };
    }

    const bundle = await res.json() as FhirBundle;
    const entries = bundle.entry ?? [];

    // Build lookup maps for included resources
    const practitioners: Record<string, FhirPractitioner> = {};
    const organizations: Record<string, FhirOrganization> = {};
    const locations: Record<string, FhirLocation> = {};

    for (const entry of entries) {
      const r = entry.resource;
      if (!r || !r.id) continue;
      if (r.resourceType === 'Practitioner') practitioners[`Practitioner/${r.id}`] = r as FhirPractitioner;
      if (r.resourceType === 'Organization') organizations[`Organization/${r.id}`] = r as FhirOrganization;
      if (r.resourceType === 'Location') locations[`Location/${r.id}`] = r as FhirLocation;
    }

    // Map PractitionerRole entries to NhsdProvider
    const providers: NhsdProvider[] = entries
      .filter((e): e is FhirBundleEntry & { resource: FhirPractitionerRole } =>
        e.resource?.resourceType === 'PractitionerRole')
      .map((e) => {
        const role = e.resource;
        const prac: FhirPractitioner = role.practitioner?.reference ? (practitioners[role.practitioner.reference] ?? {}) : {};
        const org: FhirOrganization = role.organization?.reference ? (organizations[role.organization.reference] ?? {}) : {};
        const loc: FhirLocation = role.location?.[0]?.reference ? (locations[role.location[0].reference] ?? {}) : {};
        const addr: FhirAddress = loc.address ?? org.address?.[0] ?? {};
        const pracName: FhirHumanName = prac.name?.[0] ?? {};

        return {
          id: role.id ?? '',
          name: [pracName.prefix?.[0], pracName.given?.join(' '), pracName.family].filter(Boolean).join(' '),
          givenName: pracName.given?.join(' '),
          familyName: pracName.family,
          practiceName: org.name,
          providerNumber: prac.identifier?.find((i) => i.system?.includes('hpii'))?.value,
          specialty: role.specialty?.[0]?.coding?.[0]?.display,
          phone: extractFhirTelecom(role.telecom ?? prac.telecom, 'phone'),
          fax: extractFhirTelecom(role.telecom ?? prac.telecom, 'fax'),
          email: extractFhirTelecom(role.telecom ?? prac.telecom, 'email'),
          address: {
            street: addr.line?.join(', '),
            suburb: addr.city,
            state: addr.state,
            postcode: addr.postalCode,
            formatted: addr.text,
          },
        };
      });

    return {
      providers,
      total: bundle.total ?? providers.length,
      offset: 0,
      limit: 20,
    };

  } catch (err) {
    return { providers: [], total: 0, offset: 0, limit: 20, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Get single service by ID ──────────────────────────────────────────────────

export async function getServiceById(serviceId: string): Promise<NhsdProvider | null> {
  if (!isNhsdConfigured()) return null;

  try {
    const res = await fetch(`${NHSD_API_URL}/v5/healthcareServices/${serviceId}`, {
      headers: { 'Accept': 'application/json', 'x-api-key': requireEnv('NHSD_API_KEY', 'NHSD Consumer API') },
    });
    if (!res.ok) return null;

    const svc = await res.json() as NhsdService;
    const org = svc.organisation ?? svc.organization ?? {};
    const loc = svc.locations?.[0] ?? {};
    const addr = loc.address ?? {};

    return {
      id: svc.id ?? '',
      name: svc.name ?? org.name ?? '',
      practiceName: org.name ?? svc.name,
      phone: extractPhone(svc.contacts ?? svc.telecom),
      fax: extractFax(svc.contacts ?? svc.telecom),
      email: extractEmail(svc.contacts ?? svc.telecom),
      address: {
        street: addr.line?.join(', ') ?? addr.street,
        suburb: addr.suburb ?? addr.city,
        state: addr.state,
        postcode: addr.postcode ?? addr.postalCode,
        formatted: addr.formatted,
      },
      serviceId: svc.id,
      organisationId: org.id,
    };
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatName(name: NhsdNameLike | string | null | undefined): string {
  if (!name) return 'Unknown';
  if (typeof name === 'string') return name;
  const prefix = Array.isArray(name.prefix) ? name.prefix.join(' ') : name.prefix;
  const given = Array.isArray(name.given) ? name.given.join(' ') : (name.given ?? name.firstName);
  return [prefix, given, name.family ?? name.lastName].filter(Boolean).join(' ');
}

function extractPhone(contacts: NhsdContact[] | undefined): string | undefined {
  if (!contacts || !Array.isArray(contacts)) return undefined;
  const phone = contacts.find((c) =>
    c.type === 'phone' || c.purpose === 'phone' || c.system === 'phone' ||
    c.contactType === 'PHONE' || c.contactType === 'GENERAL_PHONE'
  );
  return phone?.value ?? phone?.number;
}

function extractFax(contacts: NhsdContact[] | undefined): string | undefined {
  if (!contacts || !Array.isArray(contacts)) return undefined;
  const fax = contacts.find((c) => c.type === 'fax' || c.system === 'fax' || c.contactType === 'FAX');
  return fax?.value ?? fax?.number;
}

function extractEmail(contacts: NhsdContact[] | undefined): string | undefined {
  if (!contacts || !Array.isArray(contacts)) return undefined;
  const email = contacts.find((c) => c.type === 'email' || c.system === 'email' || c.contactType === 'EMAIL');
  return email?.value ?? email?.address;
}

function extractFhirTelecom(telecoms: FhirTelecom[] | undefined, type: 'phone' | 'fax' | 'email'): string | undefined {
  if (!telecoms) return undefined;
  return telecoms.find((t) => t.system === type)?.value;
}
