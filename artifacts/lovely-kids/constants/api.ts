const PRODUCTION_FALLBACK_DOMAIN = "lovely-kids-api.aymannsh90.workers.dev";

export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN || PRODUCTION_FALLBACK_DOMAIN}`;
