const PRODUCTION_FALLBACK_DOMAIN = "lovely-kids.replit.app";

export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN || PRODUCTION_FALLBACK_DOMAIN}`;
