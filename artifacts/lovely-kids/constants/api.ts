const PRODUCTION_API_BASE = "https://api.lovelykids.net";

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE || PRODUCTION_API_BASE;
