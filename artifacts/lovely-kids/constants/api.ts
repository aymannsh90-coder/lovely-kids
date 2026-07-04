const PRODUCTION_FALLBACK_DOMAIN = "lovely-kids--aymannsh90.replit.app";

export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN || PRODUCTION_FALLBACK_DOMAIN}`;
