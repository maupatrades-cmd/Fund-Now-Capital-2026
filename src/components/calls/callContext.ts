import { createContext, useContext } from "react";
import type { CallTarget } from "@/hooks/useCalls";

// Shared by CallProvider (which places the call) and CallButton / CallHistory (which start one or show the log).
export type CallContextValue = { canCall: boolean; busy: boolean; startCall: (target: CallTarget) => Promise<void> };

export const CallContext = createContext<CallContextValue>({ canCall: false, busy: false, startCall: async () => undefined });
export const useCalls = () => useContext(CallContext);
