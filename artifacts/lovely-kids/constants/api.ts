const PRODUCTION_FALLBACK_DOMAIN = "api.lovelykids.net";

export const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN || PRODUCTION_FALLBACK_DOMAIN}`;
