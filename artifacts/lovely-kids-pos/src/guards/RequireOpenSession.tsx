import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { usePosRuntime } from "../app/pos-context";

interface RequireOpenSessionProps {
  children: ReactNode;
}

export default function RequireOpenSession({
  children,
}: RequireOpenSessionProps) {
  const { session } = usePosRuntime();

  if (!session) {
    return (
      <Navigate
        to="/cash-session"
        replace
        state={{
          message: "يجب فتح يوم العمل قبل تنفيذ هذه العملية.",
        }}
      />
    );
  }

  return children;
}
