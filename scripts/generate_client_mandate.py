from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "FNC_Client_Mandate_Master.pdf"
LOGO = ROOT / "public" / "logo-full.png"

NAVY = colors.HexColor("#17233C")
TEAL = colors.HexColor("#1499A8")
PALE_TEAL = colors.HexColor("#EDF8F6")
MID_GREY = colors.HexColor("#536174")
LIGHT_GREY = colors.HexColor("#D7DEE7")
WARNING = colors.HexColor("#9B5C00")


class MandateDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=18 * mm,
            rightMargin=18 * mm,
            topMargin=34 * mm,
            bottomMargin=18 * mm,
            title="Fund Now Capital Client Mandate Master",
            author="Fund Now Capital (Pty) Ltd",
            subject="Client mandate and funding fee agreement",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body",
        )
        self.addPageTemplates([PageTemplate(id="mandate", frames=frame, onPage=self._header_footer)])

    def _header_footer(self, canvas, doc):
        canvas.saveState()
        if LOGO.exists():
            canvas.drawImage(
                str(LOGO),
                18 * mm,
                A4[1] - 25 * mm,
                width=56 * mm,
                height=15.2 * mm,
                preserveAspectRatio=True,
                mask="auto",
                anchor="sw",
            )
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MID_GREY)
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 14 * mm, "Fund Now Capital (Pty) Ltd")
        canvas.drawRightString(A4[0] - 18 * mm, A4[1] - 18 * mm, "Reg. 2026/066284/07 | Tel. 071 208 5218")
        canvas.setStrokeColor(TEAL)
        canvas.setLineWidth(1)
        canvas.line(18 * mm, A4[1] - 28 * mm, A4[0] - 18 * mm, A4[1] - 28 * mm)

        canvas.setStrokeColor(LIGHT_GREY)
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MID_GREY)
        canvas.drawString(18 * mm, 9 * mm, "FNC Client Mandate | Controlled master template v1.0")
        canvas.drawRightString(A4[0] - 18 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="TitleNavy", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, leading=21, textColor=NAVY, alignment=TA_LEFT, spaceAfter=2 * mm))
styles.add(ParagraphStyle(name="Subtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=12, textColor=MID_GREY, spaceAfter=4 * mm))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=NAVY, spaceBefore=3.2 * mm, spaceAfter=1.7 * mm, keepWithNext=True))
styles.add(ParagraphStyle(name="BodySmall", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.7, leading=12.1, textColor=NAVY, spaceAfter=1.8 * mm, alignment=TA_LEFT))
styles.add(ParagraphStyle(name="Clause", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.45, leading=11.65, textColor=NAVY, leftIndent=4 * mm, firstLineIndent=-4 * mm, spaceAfter=1.5 * mm))
styles.add(ParagraphStyle(name="BoxLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5, leading=9, textColor=TEAL, spaceAfter=1 * mm))
styles.add(ParagraphStyle(name="BoxText", parent=styles["Normal"], fontName="Helvetica", fontSize=8.7, leading=11.3, textColor=NAVY))
styles.add(ParagraphStyle(name="Small", parent=styles["Normal"], fontName="Helvetica", fontSize=7.4, leading=9.8, textColor=MID_GREY))
styles.add(ParagraphStyle(name="Warning", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.7, leading=10, textColor=WARNING, alignment=TA_CENTER))


def p(text: str, style: str = "BodySmall") -> Paragraph:
    return Paragraph(text, styles[style])


def clause(number: str, text: str) -> Paragraph:
    return p(f"<b>{number}</b> {text}", "Clause")


def party_box(label: str, lines: list[str]) -> list:
    return [p(label, "BoxLabel"), p("<br/>".join(lines), "BoxText")]


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = MandateDocTemplate(str(OUTPUT))
    story = []

    story.extend([
        p("CLIENT MANDATE", "TitleNavy"),
        p("FINANCE BROKERAGE AND SUCCESS FEE AGREEMENT", "Subtitle"),
        Table(
            [[p("OPERATIONAL MASTER - ATTORNEY APPROVAL REQUIRED BEFORE PRODUCTION USE", "Warning")]],
            colWidths=[doc.width],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF7E6")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#E3B65C")),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
            ]),
        ),
        Spacer(1, 4 * mm),
    ])

    parties = Table(
        [[
            party_box("THE INTRODUCER", ["<b>Fund Now Capital (Pty) Ltd</b>", "Registration: 2026/066284/07", "Represented by: Thapelo Maupa", "Email: thapelol@fundnowcapital.africa"]),
            party_box("THE CLIENT", ["<b>{{client_legal_name}}</b>", "Registration/ID: {{client_registration}}", "Represented by: {{representative_name}}", "Email: {{client_email}}"]),
        ]],
        colWidths=[doc.width / 2, doc.width / 2],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.7, LIGHT_GREY),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, LIGHT_GREY),
            ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]),
    )
    story.extend([parties, Spacer(1, 3 * mm)])

    details = Table(
        [
            [p("Mandate reference", "BoxLabel"), p("{{mandate_reference}}", "BoxText"), p("Issue date", "BoxLabel"), p("{{issue_date}}", "BoxText")],
            [p("Funding required", "BoxLabel"), p("R {{funding_amount}}", "BoxText"), p("Funding type", "BoxLabel"), p("{{funding_type}}", "BoxText")],
            [p("Purpose", "BoxLabel"), p("{{funding_purpose}}", "BoxText"), p("Expiry date", "BoxLabel"), p("{{expiry_date}}", "BoxText")],
        ],
        colWidths=[30 * mm, 58 * mm, 26 * mm, 60 * mm],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.45, LIGHT_GREY),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F6F8FA")),
            ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F6F8FA")),
            ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
        ]),
    )
    story.extend([details, Spacer(1, 3 * mm)])
    story.append(p("This mandate records the terms on which the Client appoints Fund Now Capital (Pty) Ltd (\"FNC\") to source and assist in securing funding on the Client's behalf."))

    story.extend([
        p("1. Definitions", "Section"),
        clause("1.1", "<b>Client</b> means the person or entity identified above. <b>Funder</b> means any lender, financier, investor or funding institution introduced or approached by FNC. <b>Funding</b> means any loan, advance, facility, asset finance, invoice or purchase-order finance, trade finance, investment or other financial accommodation secured through FNC's efforts."),
        clause("1.2", "<b>Successful Funding</b> occurs when Funding is approved, all conditions precedent are fulfilled or waived, and any amount is disbursed or made available to the Client or on the Client's behalf."),
        p("2. Appointment and authority", "Section"),
        clause("2.1", "The Client appoints FNC as its exclusive finance broker and authorised intermediary for the Funding requirement described above during the Term."),
        clause("2.2", "FNC may identify and approach suitable Funders, present the Client's requirement, package and submit applications, facilitate due diligence, communicate with Funders, negotiate proposed commercial terms, and coordinate approval and disbursement processes."),
        clause("2.3", "The Client authorises FNC to act only for the limited purposes stated in this mandate. FNC may not conclude a funding agreement or accept binding Funder terms on behalf of the Client without the Client's written approval."),
        clause("2.4", "The Client's separate Authority and Consent Form governs the collection, use and sharing of personal and business information. No Funder submission may occur until that form and this mandate have been signed and verified."),
        p("3. Nature and scope of services", "Section"),
        clause("3.1", "FNC acts as an independent finance broker and introducer. FNC is not a Funder and does not itself provide Funding unless separately agreed in writing."),
        clause("3.2", "FNC will use reasonable commercial efforts to source suitable options, assist with application preparation, coordinate communications and support the Client through the funding process."),
        clause("3.3", "FNC does not guarantee approval, pricing, timing, disbursement or any particular funding outcome. Every Funder retains sole discretion over its credit decision and terms."),
        p("4. Term and termination", "Section"),
        clause("4.1", "This mandate begins on the date of the last signature and continues for 12 (twelve) months, unless terminated earlier under this clause. Any renewal must be agreed in writing; the CRM must not treat an expired mandate as valid authority."),
        clause("4.2", "Either party may terminate this mandate on 30 (thirty) days' written notice. FNC may terminate immediately for fraud, material misrepresentation, unlawful conduct, non-cooperation or material breach."),
        clause("4.3", "Termination does not affect accrued rights. The confidentiality, data-protection, success-fee, non-circumvention, liability and dispute provisions survive to the extent stated in this mandate."),
    ])

    story.extend([
        p("5. Success fee", "Section"),
        Table(
            [[p("The Client agrees to pay FNC a success fee equal to <b>{{success_fee_percent}}% ({{success_fee_words}} percent)</b> of each amount of Successful Funding actually disbursed or made available. Unless a written fee schedule states otherwise, the fee is exclusive of VAT where VAT is legally chargeable.", "BodySmall")]],
            colWidths=[doc.width],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), PALE_TEAL),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#B5DDD5")),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
            ]),
        ),
        Spacer(1, 2 * mm),
        clause("5.1", "The success fee becomes due within 7 (seven) calendar days after the relevant disbursement. For staged disbursements, the fee is calculated and payable pro rata on each amount disbursed."),
        clause("5.2", "No success fee is payable on an amount that is approved but never disbursed, except where non-disbursement results from the Client's material breach after unconditional acceptance of binding funding terms."),
        clause("5.3", "Any different retainer, facility, arrangement, advisory or service fee must be disclosed and accepted by the Client in a separate written fee schedule before it applies."),
        p("6. Client obligations and warranties", "Section"),
        clause("6.1", "The Client must provide complete, accurate, current and authentic information and documents; respond promptly to reasonable requests; disclose material changes; and cooperate with lawful due-diligence and verification processes."),
        clause("6.2", "The Client warrants that it is authorised to enter into this mandate and seek the Funding, and that each representative and signatory has the necessary authority."),
        clause("6.3", "The Client remains responsible for independently reviewing and accepting or rejecting all funding offers, obtaining professional advice where appropriate, and complying with the final funding agreement."),
        p("7. Exclusivity and non-circumvention", "Section"),
        clause("7.1", "During the Term, the Client must not appoint another intermediary for the same Funding requirement or approach a Funder introduced by FNC directly without FNC's prior written consent."),
        clause("7.2", "For 24 (twenty-four) months after termination or expiry, the Client must not directly or indirectly circumvent FNC in relation to a Funder first introduced by FNC during the Term for the purpose of avoiding a fee properly due under this mandate."),
        clause("7.3", "If Successful Funding is concluded with such an introduced Funder during that 24-month period and FNC's introduction was an effective cause of the transaction, the applicable success fee remains payable."),
        p("8. Confidentiality and data protection", "Section"),
        clause("8.1", "Each party must protect the other's confidential information and use it only for this mandate, the funding process, legal compliance, risk management and enforcement of lawful rights."),
        clause("8.2", "FNC will process personal information in accordance with the Protection of Personal Information Act 4 of 2013 (POPIA), including applicable requirements concerning purpose specification, processing limitation, information quality, openness, security safeguards and data-subject participation."),
        clause("8.3", "FNC may share information only with prospective Funders and service providers reasonably required for the authorised purpose, subject to the separate Authority and Consent Form and appropriate safeguards."),
        clause("8.4", "Records will be retained only for the period required or authorised by applicable law, this mandate, a lawful business purpose or valid consent, subject to FNC's approved retention schedule. The CRM's operational retention target is 7 (seven) years from the applicable closure or termination event, unless law or an approved policy requires a different period."),
        p("9. Electronic communications and signatures", "Section"),
        clause("9.1", "The parties consent to transact electronically. This mandate may be signed in counterparts and by electronic signature. Data messages and electronic signatures will be treated in accordance with the Electronic Communications and Transactions Act 25 of 2002 and other applicable law."),
        clause("9.2", "The parties accept notices sent to the email addresses recorded above, subject to proof of transmission and any mandatory legal requirements for service."),
    ])

    story.extend([
        p("10. Liability and indemnity", "Section"),
        clause("10.1", "FNC is not liable for a Funder's credit decision, terms, delay, withdrawal, acts or omissions, or for indirect, consequential or special loss, except to the extent that liability cannot lawfully be excluded."),
        clause("10.2", "Subject to applicable law and excluding fraud, wilful misconduct or gross negligence, FNC's aggregate liability arising from this mandate is limited to the success fee actually received by FNC in relation to the affected transaction."),
        clause("10.3", "The Client indemnifies FNC against third-party claims, losses and reasonable costs caused by materially false, fraudulent, unauthorised or misleading information supplied by or on behalf of the Client, except to the extent caused by FNC's own unlawful conduct."),
        p("11. Breach", "Section"),
        clause("11.1", "If either party materially breaches this mandate and does not remedy the breach within 10 (ten) business days after written notice, the aggrieved party may terminate and pursue lawful remedies. A breach incapable of remedy may be acted on immediately."),
        p("12. General", "Section"),
        clause("12.1", "This mandate and the signed Authority and Consent Form constitute the agreement on their subject matter. If they conflict on data processing, the more specific lawful consent and privacy provision applies."),
        clause("12.2", "No amendment or waiver is effective unless recorded in writing and accepted by authorised representatives of both parties."),
        clause("12.3", "If any provision is unenforceable, it will be severed or limited to the minimum extent necessary without invalidating the remaining provisions."),
        clause("12.4", "Neither party may cede or assign this mandate without the other's prior written consent, except that FNC may use approved operators and service providers to perform administrative or technical services while remaining accountable for its obligations."),
        p("13. Governing law and disputes", "Section"),
        clause("13.1", "This mandate is governed by the laws of the Republic of South Africa."),
        clause("13.2", "The parties must first attempt in good faith to resolve a dispute through negotiation. If unresolved within 10 (ten) business days, either party may propose mediation before commencing court proceedings, without limiting urgent or interim relief."),
        clause("13.3", "Subject to applicable law, the parties consent to the jurisdiction of the courts of South Africa having jurisdiction over the dispute."),
        p("14. Acknowledgement", "Section"),
        clause("14.1", "Each signatory confirms that they have read and understood this mandate, had an opportunity to obtain independent advice, possess authority to sign, and agree to be bound by its terms."),
        Spacer(1, 4 * mm),
    ])

    signature_table = Table(
        [[
            [p("FOR AND ON BEHALF OF THE CLIENT", "Section"), Spacer(1, 11 * mm), p("Signature: __________________________________", "BodySmall"), p("Full name: {{representative_name}}", "BodySmall"), p("Capacity: {{representative_capacity}}", "BodySmall"), p("Date: {{client_signature_date}}", "BodySmall"), p("Place: {{client_signature_place}}", "BodySmall")],
            [p("FOR AND ON BEHALF OF FNC", "Section"), Spacer(1, 11 * mm), p("Signature: __________________________________", "BodySmall"), p("Thapelo Ngoanashilane Maupa", "BodySmall"), p("Founder and Director", "BodySmall"), p("Date: {{fnc_signature_date}}", "BodySmall"), p("Place: {{fnc_signature_place}}", "BodySmall")],
        ]],
        colWidths=[doc.width / 2, doc.width / 2],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.7, LIGHT_GREY),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, LIGHT_GREY),
            ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ]),
    )
    story.extend([
        KeepTogether(signature_table),
    ])

    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
