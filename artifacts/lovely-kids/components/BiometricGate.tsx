// Biometric gate removed — renders children directly.
import React from "react";

export function BiometricGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
