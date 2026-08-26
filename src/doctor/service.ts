import type { CredentialBackendStatus, CredentialProfileStatus } from "../core/keyring.js";

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skipped";
export type DoctorService = "tis" | "bb" | "ws" | "booking" | "lib-booking" | "pms";

export interface DoctorServiceDescriptor {
  service: DoctorService;
  label: string;
  campusNetwork: boolean;
}

export interface DoctorLiveResult {
  service: DoctorService;
  status: "pass" | "fail";
  message: string;
  code?: string;
  identity?: string;
}

export interface DoctorCheck {
  id: string;
  category: "runtime" | "credentials" | "service";
  status: DoctorCheckStatus;
  summary: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

export interface DoctorReport {
  schemaVersion: "1";
  generatedAt: string;
  platform: NodeJS.Platform;
  architecture: string;
  runtime: string;
  profile: string;
  live: boolean;
  requestedServices: DoctorService[];
  checks: DoctorCheck[];
  summary: {
    healthy: boolean;
    pass: number;
    warn: number;
    fail: number;
    skipped: number;
  };
}

export interface DoctorInput {
  now?: Date;
  platform?: NodeJS.Platform;
  architecture?: string;
  nodeVersion?: string;
  minimumNode?: string;
  backend: CredentialBackendStatus;
  profile: CredentialProfileStatus;
  services: DoctorService[];
  live: boolean;
  credentialSource?: string;
  liveResults?: DoctorLiveResult[];
}

export const DOCTOR_SERVICES: readonly DoctorServiceDescriptor[] = [
  { service: "tis", label: "TIS", campusNetwork: false },
  { service: "bb", label: "Blackboard", campusNetwork: false },
  { service: "ws", label: "SUSTech Global", campusNetwork: false },
  { service: "booking", label: "eHall booking", campusNetwork: true },
  { service: "lib-booking", label: "Library booking", campusNetwork: true },
  { service: "pms", label: "PMS printing", campusNetwork: true },
] as const;

export function buildDoctorReport(input: DoctorInput): DoctorReport {
  const nodeVersion = input.nodeVersion ?? process.version;
  const minimumNode = input.minimumNode ?? "20.18.0";
  const checks: DoctorCheck[] = [
    runtimeCheck(nodeVersion, minimumNode),
    credentialBackendCheck(input.backend),
    credentialProfileCheck(input.profile, input.live, input.credentialSource),
  ];
  const liveByService = new Map((input.liveResults ?? []).map((result) => [result.service, result]));

  for (const service of input.services) {
    const descriptor = descriptorFor(service);
    if (!input.live) {
      checks.push({
        id: `service.${service}`,
        category: "service",
        status: "skipped",
        summary: `${descriptor.label}: live authentication check not requested.`,
        details: { service, campusNetwork: descriptor.campusNetwork },
        ...(descriptor.campusNetwork
          ? { remediation: "Run with --live while connected to the campus network or an approved campus access path." }
          : {}),
      });
      continue;
    }

    const result = liveByService.get(service);
    if (!result) {
      checks.push({
        id: `service.${service}`,
        category: "service",
        status: "fail",
        summary: `${descriptor.label}: no live probe result was produced.`,
        details: { service, campusNetwork: descriptor.campusNetwork },
      });
      continue;
    }
    checks.push({
      id: `service.${service}`,
      category: "service",
      status: result.status,
      summary: `${descriptor.label}: ${result.message}`,
      details: {
        service,
        campusNetwork: descriptor.campusNetwork,
        ...(result.code ? { code: result.code } : {}),
        ...(result.identity ? { identity: result.identity } : {}),
      },
      ...(result.status === "fail" && descriptor.campusNetwork
        ? { remediation: "Retry from the campus network or an approved campus access path; do not treat reachability failure as bad credentials." }
        : {}),
    });
  }

  const summary = {
    healthy: !checks.some((check) => check.status === "fail"),
    pass: checks.filter((check) => check.status === "pass").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
    skipped: checks.filter((check) => check.status === "skipped").length,
  };
  return {
    schemaVersion: "1",
    generatedAt: (input.now ?? new Date()).toISOString(),
    platform: input.platform ?? process.platform,
    architecture: input.architecture ?? process.arch,
    runtime: `node ${nodeVersion}`,
    profile: input.profile.profile,
    live: input.live,
    requestedServices: [...input.services],
    checks,
    summary,
  };
}

export function descriptorFor(service: DoctorService): DoctorServiceDescriptor {
  const descriptor = DOCTOR_SERVICES.find((entry) => entry.service === service);
  if (!descriptor) throw new Error(`Unsupported doctor service: ${service}`);
  return descriptor;
}

function runtimeCheck(version: string, minimum: string): DoctorCheck {
  const current = numericVersion(version);
  const required = numericVersion(minimum);
  const supported = compareVersions(current, required) >= 0;
  return {
    id: "runtime.node",
    category: "runtime",
    status: supported ? "pass" : "fail",
    summary: supported
      ? `Node ${version} satisfies the supported minimum ${minimum}.`
      : `Node ${version} is older than the supported minimum ${minimum}.`,
    ...(!supported ? { remediation: `Install Node ${minimum} or newer.` } : {}),
    details: { current: version, minimum },
  };
}

function credentialBackendCheck(backend: CredentialBackendStatus): DoctorCheck {
  return {
    id: "credentials.backend",
    category: "credentials",
    status: backend.available ? "pass" : "warn",
    summary: backend.available
      ? `${backend.backend} is available for secure credential storage.`
      : backend.reason ?? "No secure credential backend is currently available.",
    ...(backend.remediation ? { remediation: backend.remediation } : {}),
    details: { backend: backend.backend, available: backend.available, persistent: backend.persistent },
  };
}

function credentialProfileCheck(
  profile: CredentialProfileStatus,
  live: boolean,
  credentialSource: string | undefined,
): DoctorCheck {
  if (live && credentialSource && credentialSource !== "system-keyring") {
    return {
      id: "credentials.profile",
      category: "credentials",
      status: "pass",
      summary: `Live checks resolved credentials from ${credentialSource}; the system-keyring profile was not required.`,
      details: { profile: profile.profile, credentialSource },
    };
  }
  const ready = profile.configured && profile.credentialAvailable;
  const status: DoctorCheckStatus = ready ? "pass" : live ? "fail" : "warn";
  const summary = ready
    ? `Credential profile '${profile.profile}' is configured and readable.`
    : profile.configured
      ? profile.reason ?? `Credential profile '${profile.profile}' is configured but its secret is unavailable.`
      : `Credential profile '${profile.profile}' is not configured.`;
  return {
    id: "credentials.profile",
    category: "credentials",
    status,
    summary,
    ...(profile.remediation
      ? { remediation: profile.remediation }
      : !ready
        ? { remediation: `Run 'sustech auth login --profile ${profile.profile}' or use an explicit automation credential source.` }
        : {}),
    details: {
      profile: profile.profile,
      configured: profile.configured,
      credentialAvailable: profile.credentialAvailable,
      backend: profile.backend,
      backendAvailable: profile.backendAvailable,
      profiles: profile.profiles,
    },
  };
}

function numericVersion(value: string): [number, number, number] {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
