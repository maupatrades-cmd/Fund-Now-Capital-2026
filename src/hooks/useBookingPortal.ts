import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

export const REQUESTED_BOOKING_TYPES = [
  "urgent",
  "submission",
  "submission_update",
  "consultation",
] as const;

export type RequestedBookingType = (typeof REQUESTED_BOOKING_TYPES)[number];

export const BOOKING_TYPE_LABEL: Record<RequestedBookingType, string> = {
  urgent: "Urgent support",
  submission: "Funding submission",
  submission_update: "Submission update",
  consultation: "Consultation",
};

export type BookingSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  allowed_booking_types: string[];
};

export type ScheduleBlock = {
  id: string;
  starts_at: string;
  ends_at: string;
  category: string | null;
  display_title: string;
  visibility: "busy" | "public" | string;
};

export type MyBooking = {
  id: string;
  slot_id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  booking_type: string;
  agenda: string;
  status: "requested" | "confirmed" | "declined" | "cancelled" | "completed";
  owner_note: string | null;
  client_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  created_at: string;
};

export type BookableReference = {
  reference_kind: "client" | "lead";
  reference_id: string;
  display_name: string;
};

export type BookingPortalWorkspace = {
  open_slots: BookingSlot[];
  schedule_blocks: ScheduleBlock[];
  my_bookings: MyBooking[];
  bookable_references: BookableReference[];
};

export type RequestBookingInput = {
  slotId: string;
  bookingType: RequestedBookingType;
  agenda: string;
  reference: BookableReference | null;
  clientId?: string | null;
};

const EMPTY_WORKSPACE: BookingPortalWorkspace = {
  open_slots: [],
  schedule_blocks: [],
  my_bookings: [],
  bookable_references: [],
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeWorkspace(value: unknown): BookingPortalWorkspace {
  if (!value || typeof value !== "object") return EMPTY_WORKSPACE;
  const row = value as Record<string, unknown>;
  return {
    open_slots: asArray<BookingSlot>(row.open_slots),
    schedule_blocks: asArray<ScheduleBlock>(row.schedule_blocks),
    my_bookings: asArray<MyBooking>(row.my_bookings),
    bookable_references: asArray<BookableReference>(row.bookable_references),
  };
}

export function useBookingPortalWorkspace() {
  const uid = useSession()?.user.id ?? null;

  return useQuery({
    queryKey: ["booking-portal-workspace", uid],
    enabled: uid !== null,
    staleTime: 30_000,
    queryFn: async (): Promise<BookingPortalWorkspace> => {
      const windowStart = new Date();
      const windowEnd = new Date(windowStart);
      windowEnd.setDate(windowEnd.getDate() + 30);

      const { data, error } = await supabase.rpc("booking_portal_workspace", {
        p_window_start: windowStart.toISOString(),
        p_window_end: windowEnd.toISOString(),
      });
      if (error) throw error;
      return normalizeWorkspace(data);
    },
  });
}

export function useRequestOwnerBooking() {
  const queryClient = useQueryClient();
  const uid = useSession()?.user.id ?? null;

  return useMutation({
    mutationFn: async (input: RequestBookingInput) => {
      const referenceClientId =
        input.reference?.reference_kind === "client" ? input.reference.reference_id : null;
      const referenceLeadId =
        input.reference?.reference_kind === "lead" ? input.reference.reference_id : null;

      const { data, error } = await supabase.rpc("request_owner_booking_v2", {
        p_slot_id: input.slotId,
        p_booking_type: input.bookingType,
        p_agenda: input.agenda.trim(),
        p_client_id: input.clientId ?? referenceClientId,
        p_lead_id: referenceLeadId,
        p_deal_id: null,
        p_idempotency_key: crypto.randomUUID(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-portal-workspace", uid] });
    },
  });
}
