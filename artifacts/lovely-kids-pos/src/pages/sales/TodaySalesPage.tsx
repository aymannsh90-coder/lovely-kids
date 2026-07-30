import TodaySalesPanel from "../../TodaySalesPanel";
import { usePosRuntime } from "../../app/pos-context";

export default function TodaySalesPage() {
  const { token, session, clearAuthentication } = usePosRuntime();

  if (!session) {
    return null;
  }

  return (
    <TodaySalesPanel
      token={token}
      session={session}
      refreshKey={session.updatedAt}
      onUnauthorized={clearAuthentication}
    />
  );
}
