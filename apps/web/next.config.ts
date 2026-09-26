import type { NextConfig } from 'next';
// Framework request logs include OAuth callback queries. Use the callback's
// explicit, redacted stage events instead; never forward browser logs either.
const nextConfig: NextConfig = { reactStrictMode: true, logging: false };
export default nextConfig;
