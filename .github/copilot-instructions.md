# Pachi implementation rules

- Start with [docs/README.md](../docs/README.md), the documentation entry point and authority map.
- Before implementing behavior, read the relevant product specification and domain rules, then the relevant accepted ADRs.
- Preserve the approved product scope, requirement intent, and document authority. Current canonical documents outrank archived material; archived documents are historical only.
- Do not silently change product rules, invent business invariants, replace the approved TypeScript/pnpm/Turborepo/Expo/Next.js/NestJS/Drizzle/PostgreSQL/PostGIS stack, or treat a scaffold as production readiness.
- Make the smallest coherent implementation, run meaningful checks, and report exact results honestly, including blockers and unperformed evidence.
- Keep secrets, credentials, tokens, private evidence, message content, and sensitive addresses out of source control, code, traces, and logs. Use synthetic local configuration.
- Do not add authentication, marketplace behavior, cloud infrastructure, deployment, or business tables unless the relevant product and domain documents have been read and the task explicitly authorizes that slice.
