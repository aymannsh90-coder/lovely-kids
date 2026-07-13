// Biometric login removed. This stub keeps import paths from breaking
// if any file still references this module during a transition.
export const BIOMETRIC_ENABLED_KEY = "@lovely_kids_biometric_enabled";

export function useBiometric() {
  return {
    supported: false,
    enabled: false,
    loading: false,
    enable: async () => false,
    disable: async () => {},
  };
}
