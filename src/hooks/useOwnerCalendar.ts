import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateActivity } from "@/hooks/useActivity";
import { supabase } from "@/lib/supabase";
import type { BookingStatus, CalendarCategory, CalendarVisibility } from "@/lib/ownerCalendar";

export type OwnerCalendarEvent = {
  id: string;
  title: string;
  public_title: string | null;
  category: CalendarCategory;
  visibility: CalendarVisibility;
  starts_at: string;
  ends_at: string;
  private_notes: string | null;
  client_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  status: "scheduled" | "cancelled" | "completed";
  client: { business_name: string } | { business_name: string }[] | null;
  lead: { business_name: string } | { business_name: string }[] | null;
  deal: { reference: string | null } | { reference: string | null }[] | null;
};

export type OwnerAvailabilitySlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  allowed_booking_types: CalendarCategory[];
  is_open: boolean;
};

export type OwnerBooking = {
  id: string;
  booking_type: CalendarCategory;
  agenda: string;
  client_name: string | null;
  status: BookingStatus;
  owner_note: string | null;
  created_at: string;
  slot: { id: string; starts_at: string; ends_at: string } | { id: string; starts_at: string; ends_at: string }[] | null;
  requester: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
  client: { business_name: string } | { business_name: string }[] | null;
  deal: { reference: string | null } | { reference: string | null }[] | null;
};

export type OwnerCalendarData = {
  events: OwnerCalendarEvent[];
  slots: OwnerAvailabilitySlot[];
  bookings: OwnerBooking[];
  eventsSupported: boolean;
};

export type CalendarOption = { id: string; label: string; clientId?: string | null };

function isMissingCalendarExtension(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("owner_calendar_events"));
}

export function oneCalendarRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function useOwnerCalendarRange(start: Date, end: Date) {
  return useQuery({
    queryKey: ["owner-calendar", start.toISOString(), end.toISOString()],
    queryFn: async (): Promise<OwnerCalendarData> => {
      const [eventResult, slotResult, bookingResult] = await Promise.all([
        supabase
          .from("owner_calendar_events")
          .select("id,title,public_title,category,visibility,starts_at,ends_at,private_notes,client_id,lead_id,deal_id,status,client:clients(business_name),lead:leads(business_name),deal:deals(reference)")
          .lt("starts_at", end.toISOString())
          .gt("ends_at", start.toISOString())
          .neq("status", "cancelled")
          .order("starts_at"),
        supabase
          .from("owner_availability_slots")
          .select("id,starts_at,ends_at,timezone,allowed_booking_types,is_open")
          .lt("starts_at", end.toISOString())
          .gt("ends_at", start.toISOString())
          .order("starts_at"),
        supabase
          .from("crm_bookings")
          .select("id,booking_type,agenda,client_name,status,owner_note,created_at,slot:owner_availability_slots(id,starts_at,ends_at),requester:profiles!crm_bookings_requester_id_fkey(full_name,email),client:clients(business_name),deal:deals(reference)")
          .in("status", ["requested", "confirmed"])
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      if (slotResult.error) throw slotResult.error;
      if (bookingResult.error) throw bookingResult.error;
      if (eventResult.error && !isMissingCalendarExtension(eventResult.error)) throw eventResult.error;

      return {
        events: (eventResult.data ?? []) as unknown as OwnerCalendarEvent[],
        slots: (slotResult.data ?? []) as unknown as OwnerAvailabilitySlot[],
        bookings: (bookingResult.data ?? []) as unknown as OwnerBooking[],
        eventsSupported: !eventResult.error,
      };
    },
  });
}

export function useOwnerCalendarOptions() {
  return useQuery({
    queryKey: ["owner-calendar-options"],
    queryFn: async () => {
      const [clients, leads, deals] = await Promise.all([
        supabase.from("clients").select("id,business_name").order("business_name"),
        supabase.from("leads").select("id,business_name").order("business_name"),
        supabase.from("deals").select("id,reference,client_id").order("created_at", { ascending: false }),
      ]);
      if (clients.error) throw clients.error;
      if (leads.error) throw leads.error;
      if (deals.error) throw deals.error;
      return {
        clients: (clients.data ?? []).map((item) => ({ id: item.id, label: item.business_name })) as CalendarOption[],
        leads: (leads.data ?? []).map((item) => ({ id: item.id, label: item.business_name })) as CalendarOption[],
        deals: (deals.data ?? []).map((item) => ({ id: item.id, label: item.reference || "Unreferenced deal", clientId: item.client_id })) as CalendarOption[],
      };
    },
  });
}

export type CreateOwnerCalendarEventInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  category: CalendarCategory;
  visibility: CalendarVisibility;
  publicLabel?: string;
  clientId?: string;
  leadId?: string;
  dealId?: string;
  notes?: string;
  createTask: boolean;
};

export function useCreateOwnerCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOwnerCalendarEventInput) => {
      const { error } = await supabase.rpc("owner_create_calendar_event", {
        p_title: input.title.trim(),
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_category: input.category,
        p_visibility: input.visibility,
        p_public_title: input.publicLabel?.trim() || null,
        p_client_id: input.clientId || null,
        p_lead_id: input.leadId || null,
        p_deal_id: input.dealId || null,
        p_private_notes: input.notes?.trim() || null,
        p_create_task: input.createTask,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["owner-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["owner-tasks"] });
      invalidateActivity(queryClient);
    },
  });
}

export function useCancelOwnerCalendarEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("owner_set_calendar_event_status", { p_event_id: eventId, p_status: "cancelled" });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["owner-calendar"] });
      invalidateActivity(queryClient);
    },
  });
}

export function usePublishOwnerAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { startsAt: string; endsAt: string; bookingTypes: CalendarCategory[] }) => {
      const { error } = await supabase.rpc("owner_publish_availability", {
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_allowed_booking_types: input.bookingTypes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["owner-calendar"] });
      invalidateActivity(queryClient);
    },
  });
}

export function useDecideOwnerBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bookingId: string; status: "confirmed" | "declined" | "completed"; ownerNote?: string }) => {
      const { error } = await supabase.rpc("owner_decide_booking", {
        p_booking_id: input.bookingId,
        p_status: input.status,
        p_owner_note: input.ownerNote?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["owner-calendar"] });
      invalidateActivity(queryClient);
    },
  });
}
