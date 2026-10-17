-- FNC Required Documents Spec (Owner, 10 Oct 2026), part 2: load the lists.
-- 24 funding types + the COMMON list + 9 entity-type rule sets, loaded as UNCONFIRMED (is_confirmed=false).
-- Nothing is enforced on the strength of this data: the Founder confirms each list one by one.
-- Line formats:  T|code|label|group|includes   I|list|doc|level|title|note|replaces   E|entity|op|doc|level|title|note|target
-- Levels: R required, C conditional, O optional, L required later (offer stage or disbursement).
-- Codes are the spec's own, except Equity uses EV1-EV14 because the spec reuses EQ1-EQ14 (Equipment).
-- The Founder-facing wording is the spec's; section 12's mezzanine line "Everything in 9A" is the includes link.
do $seed$
declare
  v_raw constant text := $d$
T|COMMON|Common documents (every funding type)|Common|
I|COMMON|C1|R|Signed FNC Client Application Form with POPIA consent (FNC-CAF-01)|Signed by an authorised director or member|
I|COMMON|C2|R|Signed FNC Client Mandate and Fee Agreement (FNC-CL-08)|Before any work on the file|
I|COMMON|C3|R|Lead Registration Form (FNC-LRF-01)|Completed by the agent or Switchboard|
I|COMMON|C4|R|CIPC registration certificate (CoR 14.3 or CK1)||
I|COMMON|C5|R|CIPC company documents showing all directors or members (CoR 39 or CK2)|Must match the ID copies|
I|COMMON|C6|C|Memorandum of Incorporation|Required for deals above R1 million or where a resolution is needed|
I|COMMON|C7|R|Certified ID copies of all directors, members or trustees|Certified within 3 months; passport plus work permit for non-citizens|
I|COMMON|C8|R|Proof of residential address of each director|Not older than 3 months|
I|COMMON|C9|R|Proof of business address|Lease, utility bill or municipal account, not older than 3 months|
I|COMMON|C10|R|SARS tax compliance status PIN|Checked on SARS eFiling before the file moves to Complete|
I|COMMON|C11|R|SARS income tax registration letter||
I|COMMON|C12|C|VAT registration certificate|If VAT registered|
I|COMMON|C13|C|PAYE and UIF registration|If the business has employees|
I|COMMON|C14|R|Full business bank statements, latest 6 months|Unedited PDF direct from the bank, or bank-stamped; 12 months if the funder asks|
I|COMMON|C15|R|Bank confirmation letter|Account in the business's name, not older than 3 months|
I|COMMON|C16|C|Latest annual financial statements|Required if trading more than 12 months; signed by the accountant|
I|COMMON|C17|C|Year-to-date management accounts|Required if the financial statements are older than 6 months|
I|COMMON|C18|R|Company profile|Products, history, key staff, major clients|
I|COMMON|C19|R|Signed directors' resolution authorising the application|On the company letterhead|
I|COMMON|C20|C|Personal statement of assets and liabilities of each director|Required where the funder asks for a personal surety, which is most working capital and asset deals|
I|COMMON|C21|R|Credit consent signed by each director|Allows FNC and funders to check credit bureaux|
I|COMMON|C22|O|B-BBEE certificate or sworn affidavit|Often needed for government and mining supply chains|
I|COMMON|C23|R|Existing debt schedule|All loans, overdrafts, finance agreements and arrears, with balances and instalments|
I|COMMON|C24|C|Proof of any judgments, business rescue or liquidation history, with explanation|If disclosed on the application or found on credit checks|
I|COMMON|C25|C|Organogram and shareholder structure|Required if there is more than one layer of ownership or a holding company|
I|COMMON|C26|C|Industry licences or accreditations|For example a mining permit, CIDB grading, PSIRA, transport operator licence, liquor licence|
T|purchase_order_finance|Purchase order finance|Purchase order, contract and tender finance|
I|purchase_order_finance|PO1|R|The purchase order, signed and on the buyer's letterhead|With PO number, value, delivery date, delivery address and payment terms|
I|purchase_order_finance|PO2|R|Buyer contact details for verification|Name, position, landline and email at the buyer; the Operations Manager calls to confirm the PO|
I|purchase_order_finance|PO3|C|Tender award letter or appointment letter|If the PO came from a tender|
I|purchase_order_finance|PO4|R|Supplier quotation or proforma invoice for the goods|On the supplier's letterhead, valid, with the supplier's banking details|
I|purchase_order_finance|PO5|R|Supplier company registration and bank confirmation|The funder pays the supplier directly|
I|purchase_order_finance|PO6|C|Proof that the supplier can deliver|Stock confirmation or past delivery notes, for orders above R500,000|
I|purchase_order_finance|PO7|R|Costing and margin sheet|Cost of goods, transport, other costs, selling price and profit on the order|
I|purchase_order_finance|PO8|C|Proof of previous orders completed for this or other buyers|Past POs, delivery notes and proof of payment; required if the Client has traded with the buyer before|
I|purchase_order_finance|PO9|R|Vendor registration with the buyer|Proof the Client is on the buyer's vendor list or supplier database|
I|purchase_order_finance|PO10|R|Delivery plan|Who delivers, how, by when, and who signs the delivery note|
I|purchase_order_finance|PO11|O|Buyer's payment history or terms letter|Helps the funder price the deal|
I|purchase_order_finance|PO12|L|Cession of the purchase order proceeds|Required at offer stage: signed once the funder issues an offer|
T|contract_finance|Contract finance (ongoing supply or service contracts)|Purchase order, contract and tender finance|
I|contract_finance|CF1|R|The signed contract or service level agreement|All pages, signed by both parties|
I|contract_finance|CF2|R|Contract schedule of work and payment milestones||
I|contract_finance|CF3|C|Proof of work done to date and invoices raised|If the contract has started|
I|contract_finance|CF4|C|Payment certificates or progress claims|Construction and engineering contracts|
I|contract_finance|CF5|C|Performance guarantee or retention terms|If the contract requires them|
I|contract_finance|CF6|C|Site-specific licences and health and safety file|Construction, mining and industrial contracts|
I|contract_finance|CF7|R|Project cash-flow forecast, month by month|Costs, claims and payments to the end of the contract|
I|contract_finance|CF8|R|Subcontractor and supplier list with quotes||
I|contract_finance|CF9|L|Cession of contract proceeds|Required at offer stage|
T|tender_finance|Tender finance (funding to deliver a tender awarded)|Purchase order, contract and tender finance|
I|tender_finance|TF1|R|Tender award or letter of appointment||
I|tender_finance|TF2|R|The tender document and the Client's bid, including the pricing schedule||
I|tender_finance|TF3|C|Service level agreement or contract once signed|Required before disbursement|
I|tender_finance|TF4|R|Central Supplier Database (CSD) registration report|For government tenders|
I|tender_finance|TF5|C|CIDB grading certificate|Construction tenders|
I|tender_finance|TF6|R|Letter of good standing from the Compensation Fund||
I|tender_finance|TF7|C|Proof of site handover or commencement order|If the work has started|
I|tender_finance|TF8|R|Delivery and cash-flow plan|As for contract finance|
I|tender_finance|TF9|L|Cession of tender proceeds|Required at offer stage|
T|invoice_discounting|Invoice discounting (single invoice or selected invoices)|Invoice discounting, factoring and certificate discounting|
I|invoice_discounting|ID1|R|The invoice(s) to be discounted|Tax invoice, on the Client's letterhead, with the debtor's details, PO or order reference and payment terms|
I|invoice_discounting|ID2|R|Proof of delivery or completion|Signed delivery note, goods received note, job card or completion certificate|
I|invoice_discounting|ID3|R|The purchase order or contract behind the invoice||
I|invoice_discounting|ID4|R|Debtor confirmation of the invoice|Email or letter from the debtor's accounts department confirming the invoice is approved for payment and the expected date|
I|invoice_discounting|ID5|R|Debtor contact details for verification|Accounts payable name, landline and email|
I|invoice_discounting|ID6|R|Debtor's company registration details|So the funder can assess the debtor|
I|invoice_discounting|ID7|R|Age analysis of debtors, latest month||
I|invoice_discounting|ID8|R|Age analysis of creditors, latest month||
I|invoice_discounting|ID9|C|Proof of past payments from this debtor|Bank statements highlighting previous payments; required if the Client has invoiced this debtor before|
I|invoice_discounting|ID10|R|Confirmation that the invoice is not already ceded or financed|Written declaration by the Client|
I|invoice_discounting|ID11|O|Remittance or statement from the debtor||
I|invoice_discounting|ID12|L|Cession of the invoice and notice to the debtor|Required at offer stage|
T|debtor_factoring|Debtor factoring (ongoing facility over the whole debtors' book)|Invoice discounting, factoring and certificate discounting|
I|debtor_factoring|FA1|R|Full debtors' age analysis, latest 3 months||
I|debtor_factoring|FA2|R|Full creditors' age analysis, latest 3 months||
I|debtor_factoring|FA3|R|List of top 10 debtors with contact details and credit terms||
I|debtor_factoring|FA4|R|Sample invoices and proof of delivery for the top 5 debtors||
I|debtor_factoring|FA5|R|Annual sales history by debtor, latest 12 months||
I|debtor_factoring|FA6|O|Credit control policy or process||
I|debtor_factoring|FA7|C|Existing factoring or overdraft agreements|If any; the funder needs to take them over|
I|debtor_factoring|FA8|R|Bad debt history, latest 2 years||
I|debtor_factoring|FA9|C|Sales ledger and debtor contracts|For facilities above R2 million|
T|certificate_discounting|Certificate discounting (payment certificates on construction and engineering contracts)|Invoice discounting, factoring and certificate discounting|
I|certificate_discounting|CD1|R|The payment certificate, signed by the principal agent or engineer|JBCC, GCC, NEC or FIDIC format|
I|certificate_discounting|CD2|R|The main contract or subcontract||
I|certificate_discounting|CD3|R|Appointment letter and site handover||
I|certificate_discounting|CD4|R|Certificate history on the contract|Previous certificates and proof of payment|
I|certificate_discounting|CD5|R|Employer or main contractor confirmation of the certificate|Contact details for verification|
I|certificate_discounting|CD6|R|Retention and penalty schedule||
I|certificate_discounting|CD7|R|Proof that the certificate is not ceded to a bank or supplier||
I|certificate_discounting|CD8|L|Cession of the certificate proceeds|Required at offer stage|
T|working_capital|Working capital and unsecured business loans|Working capital, merchant cash advance and business loans|
I|working_capital|WC1|R|Latest annual financial statements, 2 years|Signed by the accountant; 1 year if trading less than 2 years|C16
I|working_capital|WC2|R|Year-to-date management accounts|Income statement and balance sheet, not older than 3 months|C17
I|working_capital|WC3|R|12-month cash-flow forecast|Showing the use of funds and repayment|
I|working_capital|WC4|R|Purpose of funds statement|What the money is for, with quotes or invoices if buying anything|
I|working_capital|WC5|R|Debtors' and creditors' age analyses, latest month||
I|working_capital|WC6|R|Bank statements, 12 months|Replaces the 6-month common requirement for this type|C14
I|working_capital|WC7|R|Statement of assets and liabilities of each director|Personal surety is standard|C20
I|working_capital|WC8|C|Proof of key contracts or recurring customers|Required if more than 30% of turnover comes from one customer|
I|working_capital|WC9|C|Stock list and valuation|Retail, wholesale and manufacturing businesses|
I|working_capital|WC10|C|Lease agreement for business premises|If the business rents premises|
I|working_capital|WC11|O|Accountant's letter confirming turnover|Helps where statements are weak|
I|working_capital|WC12|C|Existing loan agreements and settlement letters|If the funding will settle existing debt|
T|merchant_cash_advance|Merchant cash advance (against card or point-of-sale turnover)|Working capital, merchant cash advance and business loans|
I|merchant_cash_advance|MC1|R|Card machine or point-of-sale statements, latest 6 months|From the card acquirer, showing monthly card turnover|
I|merchant_cash_advance|MC2|R|Bank statements, 6 months|Matching the card settlements|
I|merchant_cash_advance|MC3|R|Merchant agreement with the acquirer||
I|merchant_cash_advance|MC4|R|Lease or proof of trading premises||
I|merchant_cash_advance|MC5|R|Photos of the premises and point-of-sale|Taken by the Client or at verification|
I|merchant_cash_advance|MC6|C|Trading licence|Liquor, food, fuel or other regulated trade|
I|merchant_cash_advance|MC7|R|Monthly turnover summary by card type and cash||
T|revolving_credit|Revolving credit facility or overdraft|Working capital, merchant cash advance and business loans|
I|revolving_credit|RC1|R|Annual financial statements, 2 years||
I|revolving_credit|RC2|R|Management accounts and cash-flow forecast||
I|revolving_credit|RC3|R|Debtors' and creditors' age analyses||
I|revolving_credit|RC4|R|Facility usage plan|Peak and low months, what the facility covers|
I|revolving_credit|RC5|C|Security offered|Cession of debtors, bond, surety, as the funder requires|
I|revolving_credit|RC6|C|Existing facility letters|If the Client has facilities elsewhere|
T|equipment_finance|Equipment and machinery finance (new or used, bought from a supplier)|Asset, equipment, vehicle and asset-backed finance|
I|equipment_finance|EQ1|R|Supplier quotation or proforma invoice|On letterhead, itemised, with serial or model numbers, price, VAT and validity|
I|equipment_finance|EQ2|R|Supplier company registration and bank confirmation|The funder pays the supplier|
I|equipment_finance|EQ3|R|Equipment specification sheet or brochure||
I|equipment_finance|EQ4|C|Photos of the equipment|Required for used equipment|
I|equipment_finance|EQ5|C|Independent valuation|Used equipment above R250,000, or where the funder asks|
I|equipment_finance|EQ6|C|Proof of the supplier's ownership and that the equipment is unencumbered|Used equipment|
I|equipment_finance|EQ7|R|Business case for the equipment|What it will earn, the contract or work it will do, and the expected income|
I|equipment_finance|EQ8|C|Contract or purchase order the equipment will service|If the equipment is being bought for a specific contract|
I|equipment_finance|EQ9|C|Deposit confirmation|If the funder requires a deposit, proof of funds|
I|equipment_finance|EQ10|R|Insurance quotation for the equipment|Comprehensive, with the funder noted as the interested party|
I|equipment_finance|EQ11|R|Site or premises where the equipment will be kept|Address and proof of right to occupy|
I|equipment_finance|EQ12|C|Operator licences or certificates|Cranes, forklifts, earthmoving equipment|
T|vehicle_fleet_finance|Vehicle and fleet finance (trucks, bakkies, buses, trailers, taxis)|Asset, equipment, vehicle and asset-backed finance|
I|vehicle_fleet_finance|VF1|R|Dealer quotation or offer to purchase|With VIN, engine number, model, year, mileage and price|
I|vehicle_fleet_finance|VF2|R|Dealer registration and bank confirmation||
I|vehicle_fleet_finance|VF3|C|Vehicle registration certificate (NaTIS)|Used vehicles|
I|vehicle_fleet_finance|VF4|C|Roadworthy certificate|Used vehicles|
I|vehicle_fleet_finance|VF5|C|Photos of the vehicle, all sides, odometer and interior|Used vehicles|
I|vehicle_fleet_finance|VF6|C|Independent valuation or dealer book value|Used vehicles above R200,000|
I|vehicle_fleet_finance|VF7|R|Operator licence (road transport permit)|Goods or passenger transport|
I|vehicle_fleet_finance|VF8|R|Transport contract or route agreement|The work the vehicle will do, with rates|
I|vehicle_fleet_finance|VF9|R|Driver's licences and PrDPs of the drivers||
I|vehicle_fleet_finance|VF10|C|Fleet list with existing vehicles and finance|If the Client already runs a fleet|
I|vehicle_fleet_finance|VF11|R|Insurance quotation with the funder noted||
I|vehicle_fleet_finance|VF12|R|Tracking device confirmation|Most funders insist on tracking|
I|vehicle_fleet_finance|VF13|C|Taxi association membership and route permit|Minibus taxis|
I|vehicle_fleet_finance|VF14|C|Cross-border permits|If operating outside South Africa|
T|asset_backed_finance|Asset-backed finance (a loan secured by an asset the Client already owns)|Asset, equipment, vehicle and asset-backed finance|
I|asset_backed_finance|AB1|R|Proof of ownership of the asset|Title deed, NaTIS certificate, invoice and proof of payment, or share certificate|
I|asset_backed_finance|AB2|R|Proof that the asset is unencumbered, or the current finance balance|Settlement letter from any existing financier|
I|asset_backed_finance|AB3|R|Independent valuation of the asset|Not older than 3 months, by a valuer the funder accepts|
I|asset_backed_finance|AB4|R|Photos of the asset and its location||
I|asset_backed_finance|AB5|R|Insurance policy on the asset|Current, with the schedule|
I|asset_backed_finance|AB6|R|Purpose of funds and repayment plan||
I|asset_backed_finance|AB7|C|Rates and taxes clearance|Property assets|
I|asset_backed_finance|AB8|C|Lease agreements on the asset|If the asset is rented out|
I|asset_backed_finance|AB9|C|Maintenance and service records|Vehicles and machinery|
T|sale_and_leaseback|Sale and leaseback, and rental finance|Asset, equipment, vehicle and asset-backed finance|
I|sale_and_leaseback|SL1|R|Proof of ownership and purchase invoice of the asset||
I|sale_and_leaseback|SL2|R|Independent valuation||
I|sale_and_leaseback|SL3|R|Asset condition report and photos||
I|sale_and_leaseback|SL4|R|Proposed lease term and rental affordability|From the cash-flow forecast|
I|sale_and_leaseback|SL5|R|Insurance and maintenance arrangements||
T|bridging_finance|Bridging finance (short-term money against a certain incoming payment)|Bridging and property finance|
I|bridging_finance|BR1|R|Proof of the incoming payment|One of: signed sale agreement; tender award and contract; approved payment certificate; signed settlement agreement; confirmed insurance claim|
I|bridging_finance|BR2|R|Confirmation of the payment date and amount from the paying party|Attorney's letter, employer's letter or debtor confirmation|
I|bridging_finance|BR3|R|Contact details of the paying party or attorney|For verification|
I|bridging_finance|BR4|R|Schedule of all amounts to be paid out of the incoming money|Bonds, creditors, agents, taxes; shows what is left|
I|bridging_finance|BR5|R|Purpose of the bridge||
I|bridging_finance|BR6|R|Proof the incoming payment is not already ceded|Written declaration|
I|bridging_finance|BR7|C|Existing debt against the same source|If any|
I|bridging_finance|BR8|L|Irrevocable payment instruction or cession|Required at offer stage: the paying party pays the funder directly|
T|property_bridging|Property bridging (against a property sale or bond registration)|Bridging and property finance|
I|property_bridging|PB1|R|Signed offer to purchase or sale agreement|All suspensive conditions met|
I|property_bridging|PB2|R|Transfer attorney's letter confirming the transfer status and expected date||
I|property_bridging|PB3|R|Bond approval or guarantee from the buyer's bank||
I|property_bridging|PB4|R|Title deed and deeds office search||
I|property_bridging|PB5|R|Rates clearance figures||
I|property_bridging|PB6|C|Existing bond settlement figures|If bonded|
I|property_bridging|PB7|C|Estate agent's commission agreement|If an agent is involved|
I|property_bridging|PB8|L|Irrevocable undertaking from the transfer attorney|Required at offer stage|
T|commercial_property_finance|Commercial property finance (buying or developing property)|Bridging and property finance|
I|commercial_property_finance|CP1|R|Offer to purchase or sale agreement||
I|commercial_property_finance|CP2|R|Independent property valuation|By a registered valuer, not older than 3 months|
I|commercial_property_finance|CP3|R|Title deed and deeds office search||
I|commercial_property_finance|CP4|R|Zoning certificate and approved building plans||
I|commercial_property_finance|CP5|C|Lease agreements with existing tenants|Income-producing property|
I|commercial_property_finance|CP6|C|Rent roll and tenant schedule|Income-producing property|
I|commercial_property_finance|CP7|R|Municipal rates and services accounts||
I|commercial_property_finance|CP8|C|Development budget, builder's contract and quotes|Development deals|
I|commercial_property_finance|CP9|C|Professional team appointments|Architect, engineer, quantity surveyor for developments|
I|commercial_property_finance|CP10|R|Deposit confirmation|Proof of own contribution|
I|commercial_property_finance|CP11|C|Feasibility study|Developments and deals above R5 million|
I|commercial_property_finance|CP12|C|Environmental and land-use approvals|If required by the municipality|
T|import_finance|Import finance (paying overseas suppliers)|Trade, import, export and supply chain finance|
I|import_finance|IM1|R|Supplier's proforma invoice|With Incoterms, currency, payment terms and shipping details|
I|import_finance|IM2|R|Supplier due diligence|Company registration, website, references; the Operations Manager verifies|
I|import_finance|IM3|R|Sales contract or purchase order from the Client's buyer|Proof the goods are sold on|
I|import_finance|IM4|C|Import permit|For controlled goods|
I|import_finance|IM5|R|Customs registration (SARS importer code)||
I|import_finance|IM6|R|Freight and clearing agent quotation||
I|import_finance|IM7|R|Landed cost calculation|Goods, freight, duties, VAT, clearing, margin|
I|import_finance|IM8|R|Marine insurance quotation||
I|import_finance|IM9|C|Previous import history|Bills of entry for past shipments, if any|
I|import_finance|IM10|C|Letter of credit or bank guarantee terms|If the supplier requires one|
T|export_finance|Export finance (pre-shipment and post-shipment)|Trade, import, export and supply chain finance|
I|export_finance|EX1|R|Export sales contract or confirmed order from the foreign buyer||
I|export_finance|EX2|R|Foreign buyer due diligence|Registration, references, credit report if available|
I|export_finance|EX3|C|Letter of credit or buyer's payment undertaking|Required for first-time buyers|
I|export_finance|EX4|R|Export permit and SARS exporter code||
I|export_finance|EX5|R|Production or sourcing plan and costing||
I|export_finance|EX6|L|Shipping documents|Required at disbursement: bill of lading, packing list, certificate of origin|
I|export_finance|EX7|C|Credit insurance|Where the funder requires it|
T|supply_chain_finance|Supply chain and supplier finance (early payment of a large buyer's invoices)|Trade, import, export and supply chain finance|
I|supply_chain_finance|SC1|R|Supply agreement with the anchor buyer||
I|supply_chain_finance|SC2|R|Buyer's approved invoices and payment schedule||
I|supply_chain_finance|SC3|R|Buyer's confirmation of the supply chain finance arrangement||
I|supply_chain_finance|SC4|R|Supply history, latest 12 months|Invoices and payments|
I|supply_chain_finance|SC5|R|Buyer's vendor portal registration||
T|stock_finance|Stock and inventory finance|Trade, import, export and supply chain finance|
I|stock_finance|ST1|R|Stock list with cost and selling values||
I|stock_finance|ST2|R|Supplier quotations for the stock to be bought||
I|stock_finance|ST3|R|Sales history and stock turnover, latest 12 months||
I|stock_finance|ST4|R|Warehouse or storage lease and insurance||
I|stock_finance|ST5|C|Orders or contracts the stock will fulfil|If pre-sold|
I|stock_finance|ST6|C|Stock count or audit|Facilities above R1 million|
T|equity_investment|Equity investment|Equity, mezzanine, project finance, grants and development funding|
I|equity_investment|EV1|R|Business plan or investor deck|Market, product, team, traction, use of funds, exit|
I|equity_investment|EV2|R|Annual financial statements, 3 years|Or since inception if younger|
I|equity_investment|EV3|R|Year-to-date management accounts||
I|equity_investment|EV4|R|3 to 5 year financial forecast with assumptions|Income statement, balance sheet and cash flow|
I|equity_investment|EV5|R|Share register and shareholders' agreement||
I|equity_investment|EV6|R|Memorandum of Incorporation||C6
I|equity_investment|EV7|R|Proposed deal terms|Amount, percentage offered, pre-money valuation, board seats|
I|equity_investment|EV8|R|Valuation report or valuation method||
I|equity_investment|EV9|R|Key contracts, licences and intellectual property||
I|equity_investment|EV10|R|CVs of directors and key management||
I|equity_investment|EV11|C|Existing investor or loan agreements|If any|
I|equity_investment|EV12|R|Litigation and contingent liabilities schedule||
I|equity_investment|EV13|C|Employee list and key employment contracts|More than 10 employees|
I|equity_investment|EV14|R|Tax computations and SARS statements of account, 3 years||
T|mezzanine_finance|Mezzanine and convertible loans|Equity, mezzanine, project finance, grants and development funding|equity_investment
I|mezzanine_finance|MZ2|R|Senior debt agreements and intercreditor position||
I|mezzanine_finance|MZ3|R|Proposed conversion or warrant terms||
I|mezzanine_finance|MZ4|R|Security available for the mezzanine lender||
T|project_finance|Project finance (mining, energy, infrastructure, agriculture projects)|Equity, mezzanine, project finance, grants and development funding|
I|project_finance|PF1|R|Feasibility study, bankable where available||
I|project_finance|PF2|R|Project financial model with assumptions||
I|project_finance|PF3|R|Mining right, prospecting right, generation licence or equivalent permit|Certified copy|
I|project_finance|PF4|R|Environmental authorisation and water use licence|Or proof of application|
I|project_finance|PF5|R|Offtake agreement or memorandum of understanding|Who buys the output and at what price|
I|project_finance|PF6|R|Land rights: title deed, lease or surface use agreement||
I|project_finance|PF7|R|Engineering, procurement and construction contract or quotes||
I|project_finance|PF8|C|Technical report or competent person's report|Mining and energy projects|
I|project_finance|PF9|R|Project team and sponsor CVs||
I|project_finance|PF10|R|Sponsor equity contribution and proof of funds||
I|project_finance|PF11|R|Insurance programme||
I|project_finance|PF12|C|Community and social labour plan|Mining projects|
I|project_finance|PF13|R|Project timeline and milestone schedule||
T|grants_development|Grants and development funding (SEFA, NEF, IDC, DTIC, provincial agencies)|Equity, mezzanine, project finance, grants and development funding|
I|grants_development|GR1|R|The agency's own application form|Each agency has its own|
I|grants_development|GR2|R|Business plan in the agency's format||
I|grants_development|GR3|R|Financial forecast, 3 years||
I|grants_development|GR4|R|Proof of B-BBEE ownership status|Most development funding is ownership-linked|
I|grants_development|GR5|R|Job creation plan|Number of jobs, timing and wages|
I|grants_development|GR6|R|Quotations for every item to be funded|Usually 2 to 3 quotes per item|
I|grants_development|GR7|C|Proof of own contribution|If the agency requires co-funding|
I|grants_development|GR8|O|Municipal or local economic development support letter||
I|grants_development|GR9|C|Training and skills plan|For skills-linked funding|
I|grants_development|GR10|R|Proof of market: offtake letters or customer commitments||
E|pty_ltd|note|||Standard list: CoR 14.3, CoR 39, Memorandum of Incorporation, share register|
E|pty_ltd|add|ENT-PTY1|C|Share register|Part of the standard (Pty) Ltd set; Founder to confirm whether this is Required|
E|cc|replace|CK1|R|CK1 founding statement|Replaces the CoR 14.3 registration certificate|C4
E|cc|replace|CK2|R|CK2 amended founding statement showing all members|Replaces CoR 39|C5
E|cc|replace|ENT-CC1|C|Association agreement (if any)|Replaces the Memorandum of Incorporation|C6
E|cc|replace|ENT-CC2|R|Signed members' resolution authorising the application|Replaces the directors' resolution|C19
E|sole_proprietor|remove|||No CIPC documents for a sole proprietor||C4
E|sole_proprietor|remove|||No CIPC documents for a sole proprietor||C5
E|sole_proprietor|remove|||Not applicable to a sole proprietor||C6
E|sole_proprietor|remove|||No company resolution for a sole proprietor||C19
E|sole_proprietor|remove|||No shareholder structure for a sole proprietor||C25
E|sole_proprietor|add|ENT-SP1|R|Certified ID of the owner|Certified within 3 months|
E|sole_proprietor|add|ENT-SP2|R|Proof of trading name|Invoices, bank account name|
E|sole_proprietor|add|ENT-SP3|R|SARS personal income tax registration||
E|sole_proprietor|add|ENT-SP4|C|Personal bank statements|If business banking is not separate|
E|sole_proprietor|set_level||R|The personal statement of assets and liabilities is Required for a sole proprietor||C20
E|partnership|add|ENT-PA1|R|Partnership agreement|All partners sign the application and mandate|
E|partnership|add|ENT-PA2|R|IDs and proof of address of every partner||
E|trust|replace|ENT-TR1|R|Trust deed|Replaces the CIPC registration certificate|C4
E|trust|replace|ENT-TR2|R|Letters of authority from the Master of the High Court|Replaces the CIPC company documents|C5
E|trust|replace|ENT-TR3|R|IDs of all trustees|Replaces the director IDs|C7
E|trust|replace|ENT-TR4|R|Trustees' resolution|Replaces the directors' resolution|C19
E|trust|add|ENT-TR5|R|The trust's tax number||
E|trust|add|ENT-TR6|C|Beneficiary details|Where the funder asks|
E|npo|add|ENT-NP1|R|NPO registration certificate|From the Department of Social Development; CoR 14.3 stays|
E|npo|replace|ENT-NP2|R|Board resolution|Replaces the directors' resolution|C19
E|npo|replace|ENT-NP3|R|Latest audited financial statements|Replaces the annual financial statements|C16
E|npo|add|ENT-NP4|R|Funding or donor agreements that show income||
E|joint_venture|add|ENT-JV1|R|JV agreement signed by all parties||
E|joint_venture|add|ENT-JV2|R|JV bank account confirmation||
E|joint_venture|add|ENT-JV3|R|Resolution of each partner authorising the JV||
E|joint_venture|add|ENT-JV4|C|The JV's own tax number|If registered|
E|joint_venture|note|||The full common list applies to each JV partner|
E|cooperative|replace|ENT-CO1|R|Registration certificate from CIPC as a co-operative|Replaces the company registration certificate|C4
E|cooperative|replace|ENT-CO2|R|Constitution|Replaces the company documents|C5
E|cooperative|add|ENT-CO3|R|Members' list and resolution||
E|foreign_owned|add|ENT-FO1|R|Passports and valid visas or permits of foreign directors||
E|foreign_owned|add|ENT-FO2|R|Proof of South African bank account||
E|foreign_owned|add|ENT-FO3|C|Exchange control approval|If funds leave the country|
$d$;
  ln text; p text[]; v_owner uuid; v_seq integer := 0;
  v_lvl public.doc_requirement_level;
begin
  if exists (select 1 from public.doc_lists) then
    raise notice 'doc_lists already loaded; skipping the seed';
    return;
  end if;
  select pr.id into v_owner from public.profiles pr where pr.role::text = 'owner' order by pr.created_at limit 1;
  foreach ln in array string_to_array(v_raw, E'\n') loop
    continue when btrim(ln) = '';
    p := string_to_array(ln, '|');
    v_seq := v_seq + 1;
    if p[1] = 'T' then
      insert into public.doc_lists (code, label, group_label, kind, includes_list_code)
        values (p[2], p[3], p[4], case when p[2] = 'COMMON' then 'common' else 'funding_type' end, nullif(p[5], ''));
      insert into public.doc_list_versions (list_code, version, created_by, change_note)
        values (p[2], 1, v_owner, 'Loaded from the FNC Required Documents Spec, 10 Oct 2026. Unconfirmed.');
    elsif p[1] = 'I' then
      v_lvl := (case p[4] when 'R' then 'required' when 'C' then 'conditional' when 'O' then 'optional' when 'L' then 'required_later' end)::public.doc_requirement_level;
      insert into public.doc_catalogue (code, title, note) values (p[3], p[5], nullif(p[6], ''));
      insert into public.doc_list_items (list_code, version, doc_code, level, replaces_code, sort_order)
        values (p[2], 1, p[3], v_lvl, nullif(p[7], ''), v_seq);
    elsif p[1] = 'E' then
      v_lvl := (case p[5] when 'R' then 'required' when 'C' then 'conditional' when 'O' then 'optional' when 'L' then 'required_later' end)::public.doc_requirement_level;
      if p[3] in ('add', 'replace') then
        insert into public.doc_catalogue (code, title, note) values (p[4], p[6], nullif(p[7], ''));
      end if;
      insert into public.doc_entity_rules (entity_type, op, doc_code, level, target_code, note, sort_order)
        values (p[2], p[3], nullif(p[4], ''), v_lvl, nullif(p[8], ''),
                case when p[3] in ('note', 'remove', 'set_level') then p[6] else null end, v_seq);
    end if;
  end loop;
end
$seed$;
