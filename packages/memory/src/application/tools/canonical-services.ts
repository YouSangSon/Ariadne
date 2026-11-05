import type { CanonicalServices, CreateToolRegistryOptions, WithCanonicalServices } from "../contracts/tools.js";
import type { AuditLogRepository } from "../ports/audit-log.js";


export type CanonicalServicesResolverOptions = Pick<
  CreateToolRegistryOptions,
  "resolveCanonicalServices"
>;

export function createServiceBackedAuditLog(
  withCanonicalServices: WithCanonicalServices,
): AuditLogRepository {
  return {
    record(entry) {
      return withCanonicalServices((services) => services.auditLog.record(entry));
    },
    listByOrganization(organizationId, options) {
      return withCanonicalServices((services) =>
        services.auditLog.listByOrganization(organizationId, options),
      );
    },
  };
}

export function createCanonicalServicesResolver(
  options: CanonicalServicesResolverOptions,
  bootstrap: () => Promise<CanonicalServices>,
): WithCanonicalServices {
  let promise: Promise<CanonicalServices> | null = null;

  return async function withCanonicalServices<T>(
    callback: (services: CanonicalServices) => Promise<T>,
  ): Promise<T> {
    // Test-injection path: resolve fresh per call so individual tests can swap
    // services and observe close() bookkeeping.
    if (options.resolveCanonicalServices) {
      const services = await options.resolveCanonicalServices();
      try {
        return await callback(services);
      } finally {
        await services.close?.();
      }
    }

    // Production path: lazy singleton. The promise = null assignment on
    // failure is load-bearing — it lets a transient bootstrap error (e.g.,
    // Postgres restart, OpenAI key rotation in flight) recover on the next
    // call instead of pinning the registry to a permanently broken state.
    if (!promise) {
      promise = bootstrap().catch((error: unknown) => {
        promise = null;
        throw error;
      });
    }

    const services = await promise;
    return await callback(services);
  };
}
