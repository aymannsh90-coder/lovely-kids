export function useClerkAuth() {
  return {
    isLoaded: true,
    isSignedIn: false as boolean | undefined,
    signOut: async () => {},
    getToken: async () => null as string | null,
  };
}
