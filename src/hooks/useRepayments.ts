import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
export type Instalment={id:string;instalment_number:number;due_date:string;amount_due:string;amount_paid:string;paid_at:string|null};
export type Schedule={id:string;total_repayable:string;status:string;instalments:Instalment[];submission:{deal:{reference:string|null}|{reference:string|null}[]|null;funder:{name:string}|{name:string}[]|null}|null};
export function useRepaymentSchedules(){return useQuery({queryKey:["repayments"],queryFn:async()=>{const{data,error}=await supabase.from("repayment_schedules").select("id,total_repayable,status,submission:deal_funder_submissions(deal:deals(reference),funder:funders(name)),instalments:repayment_instalments(id,instalment_number,due_date,amount_due,amount_paid,paid_at)").order("created_at",{ascending:false});if(error)throw error;return(data??[])as unknown as Schedule[];}})}
export function useFundedSubmissions(){return useQuery({queryKey:["repayment-options"],queryFn:async()=>{const{data,error}=await supabase.from("deal_funder_submissions").select("id,amount_funded,deal:deals(reference),funder:funders(name)").not("amount_funded","is",null).order("funded_at",{ascending:false});if(error)throw error;return data??[];}})}
function useRpc(name:string){const qc=useQueryClient();return useMutation({mutationFn:async(args:Record<string,unknown>)=>{const{error}=await supabase.rpc(name,args);if(error)throw error;},onSuccess:()=>void qc.invalidateQueries({queryKey:["repayments"]})});}
export function useCreateSchedule(){return useRpc("owner_create_repayment_schedule")}
export function useRecordRepayment(){return useRpc("owner_record_repayment")}
