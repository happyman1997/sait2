import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Сгенерированные next dev файлы AGENTS.md / CLAUDE.md не нужны.
  agentRules: false,
  serverExternalPackages: ['pg']
};

export default nextConfig;
