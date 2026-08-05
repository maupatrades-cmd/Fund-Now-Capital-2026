import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
export type QualityIssue={key:string;area:"Client"|"Lead"|"Deal"|"Funder";label:string;problem:string;to:string;severity:"high"|"medium"};
export function useDataQuality(){return useQuery({queryKey:["data-quality"],queryFn:async():Promise<QualityIssue[]>=>{
  const[clients,leads,deals,funders]=await Promise.all([
    supabase.from("clients").select("id,business_name,cipc_number,industry_id,monthly_turnover,contacts:client_contacts(count)").limit(500),
    supabase.from("leads").select("id,business_name,cipc_number,industry_id,contact_cell,contact_email,funding_amount,qualification_stage").limit(500),
    supabase.from("deals").select("id,reference,amount_requested,client_id").limit(500),
    supabase.from("funders").select("id,name,is_active,is_contracted,short_code,display_name_for_partner").limit(500),
  ]);
  const error=clients.error||leads.error||deals.error||funders.error;if(error)throw error;
  const issues:QualityIssue[]=[];
  for(const row of clients.data??[]){const missing=[!row.cipc_number&&"CIPC number",!row.industry_id&&"industry",row.monthly_turnover==null&&"monthly turnover",Number(row.contacts?.[0]?.count??0)===0&&"contact"].filter(Boolean);if(missing.length)issues.push({key:`client-${row.id}`,area:"Client",label:row.business_name,problem:`Missing ${missing.join(", ")}`,to:`/clients/${row.id}/edit`,severity:missing.length>2?"high":"medium"});}
  for(const row of leads.data??[]){if(row.qualification_stage!=="qualified"){const missing=[!row.cipc_number&&"CIPC number",!row.industry_id&&"industry",(!row.contact_cell&&!row.contact_email)&&"contact method",row.funding_amount==null&&"funding amount"].filter(Boolean);if(missing.length)issues.push({key:`lead-${row.id}`,area:"Lead",label:row.business_name,problem:`Missing ${missing.join(", ")}`,to:`/leads/${row.id}/edit`,severity:missing.length>2?"high":"medium"});}}
  for(const row of deals.data??[]){if(row.amount_requested==null)issues.push({key:`deal-${row.id}`,area:"Deal",label:row.reference??"Deal",problem:"Missing amount requested",to:`/deals/${row.id}`,severity:"high"});}
  for(const row of funders.data??[]){const missing=[row.is_contracted&&!row.short_code&&"short code",!row.display_name_for_partner&&"partner display name"].filter(Boolean);if(row.is_active&&missing.length)issues.push({key:`funder-${row.id}`,area:"Funder",label:row.name,problem:`Missing ${missing.join(", ")}`,to:`/funders/${row.id}/edit`,severity:"high"});}
  return issues.sort((a,b)=>a.severity===b.severity?a.area.localeCompare(b.area):a.severity==="high"?-1:1);
}})}
