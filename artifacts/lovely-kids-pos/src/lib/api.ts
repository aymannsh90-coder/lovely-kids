const fallbackApiBaseUrl = "https://api.lovelykids.net";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || fallbackApiBaseUrl
).replace(/\/+$/, "");
