import {
  createContext,
  useContext,
  type Dispatch,
  type FormEventHandler,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { CashSession, PosUser } from "../lib/api";

export interface PosRuntimeValue {
  token: string;
  user: PosUser | null;
  session: CashSession | null;
  setSession: Dispatch<SetStateAction<CashSession | null>>;
  clearAuthentication: () => void;
  handleLogout: () => Promise<void>;

  openingBalance: string;
  setOpeningBalance: Dispatch<SetStateAction<string>>;
  openingNote: string;
  setOpeningNote: Dispatch<SetStateAction<string>>;
  openBusy: boolean;
  openError: string;
  openMessage: string;
  handleOpenDay: FormEventHandler<HTMLFormElement>;

  closingBalance: string;
  setClosingBalance: Dispatch<SetStateAction<string>>;
  closingNote: string;
  setClosingNote: Dispatch<SetStateAction<string>>;
  closeBusy: boolean;
  closeError: string;
  handleCloseDay: FormEventHandler<HTMLFormElement>;
}

const PosRuntimeContext = createContext<PosRuntimeValue | null>(null);

interface PosRuntimeProviderProps {
  value: PosRuntimeValue;
  children: ReactNode;
}

export function PosRuntimeProvider({
  value,
  children,
}: PosRuntimeProviderProps) {
  return (
    <PosRuntimeContext.Provider value={value}>
      {children}
    </PosRuntimeContext.Provider>
  );
}

export function usePosRuntime() {
  const context = useContext(PosRuntimeContext);

  if (!context) {
    throw new Error("usePosRuntime must be used inside PosRuntimeProvider");
  }

  return context;
}
