import SalePanel from "../../SalePanel";
import { usePosRuntime } from "../../app/pos-context";

export default function NewSalePage() {
  const { token, user, session, setSession, clearAuthentication } =
    usePosRuntime();

  if (!session) {
    return null;
  }

  return (
    <SalePanel
      token={token}
      session={session}
      cashierName={user?.name ?? "موظف"}
      onSessionChange={setSession}
      onUnauthorized={clearAuthentication}
    />
  );
}
