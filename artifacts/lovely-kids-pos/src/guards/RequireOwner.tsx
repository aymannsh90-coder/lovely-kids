import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { usePosRuntime } from "../app/pos-context";

interface RequireOwnerProps {
  children: ReactNode;
}

export default function RequireOwner({
  children,
}: RequireOwnerProps) {
  const { user } = usePosRuntime();

  if (!user?.isOwner) {
    return <Navigate to="/" replace />;
  }

  return children;
}
