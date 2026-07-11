import { ClerkLoaded, ClerkProvider } from "@clerk/expo";
import React from "react";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

export function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  if (!publishableKey) {
    return <>{children}</>;
  }
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ClerkLoaded>{children}</ClerkLoaded>
    </ClerkProvider>
  );
}
