import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type InvoiceDispatch = {
  id: string;
  invoice_id: string;
  retry_of: string | null;
  attempt_number: number;
  recipient_email: string;
  recipient_name: string | null;
  status: "queued" | "sent" | "delivered" | "failed" | "bounced";
  failure_message: string | null;
  queued_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
};

export function useInvoiceDispatches() {
  return useQuery({
    queryKey: ["funder-invoice-dispatches"],
    queryFn: async (): Promise<InvoiceDispatch[]> => {
      const { data, error } = await supabase
        .from("funder_invoice_dispatches")
        .select(
          "id, invoice_id, retry_of, attempt_number, recipient_email, recipient_name, status, failure_message, queued_at, sent_at, delivered_at, failed_at",
        )
        .order("attempt_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoiceDispatch[];
    },
  });
}

export function useQueueInvoiceDispatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: {
      invoiceId: string;
      recipientEmail: string;
      recipientName: string | null;
      retryOf: string | null;
    }) => {
      const { data, error } = await supabase.rpc("queue_funder_invoice_dispatch", {
        p_invoice_id: variables.invoiceId,
        p_recipient_email: variables.recipientEmail,
        p_recipient_name: variables.recipientName,
        p_retry_of: variables.retryOf,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["funder-invoice-dispatches"] });
    },
  });
}
