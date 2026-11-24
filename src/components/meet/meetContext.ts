import { createContext, useContext } from "react";

// Shared by MeetProvider (which fills it) and the Call buttons / pages (which read it).
export type MeetContextValue = {
  enabled: boolean;
  online: Set<string>;
  inCall: boolean;
  call: (profileId: string, name: string, video?: boolean) => Promise<void>;
};

export const MeetContext = createContext<MeetContextValue>({ enabled: false, online: new Set(), inCall: false, call: async () => {} });
export const useMeet = () => useContext(MeetContext);
