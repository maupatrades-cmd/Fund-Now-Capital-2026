# Role Onboarding and Calendar — Manual Smoke Test

Use this checklist after the role-onboarding feature PR is merged and deployed. It complements the automated source contracts; it does not send real invitations or modify production data by itself.

## Preconditions

- Use dedicated test email addresses, not a real client or team member.
- Sign in as the Owner.
- Have one active test partner available for Sub-Agent attribution.
- Publish at least three future slots: one before 14:00 SAST, one from 14:00–20:00 SAST, and one after 20:00 SAST.
- Record every test account and booking so it can be deactivated or removed after verification.

## Owner role invitations

1. Open **Team** and choose **Invite New Person**.
2. Confirm the role picker offers all four supported choices.

### Partner invitation

- Select **Partner**, enter the test contact details, and send the invitation.
- Expected: the invitation succeeds, the profile is assigned `partner`, and login lands in `/partner`.
- Expected boundary: the account cannot open Owner, Contractor, Lead Referrer, or another partner organisation's data.

### Contractor invitation

- Select **Contractor**, enter the test contact details, and send the invitation.
- Expected: the profile is assigned `contractor`, and login lands in `/contractor`.
- Expected boundary: the account cannot open Owner, Partner, or Lead Referrer workspaces.

### Lead Referrer invitation

- Select **Lead Referrer**, enter the test contact details, and send the invitation.
- Expected: the profile is assigned `lead_referrer`, and login lands in `/lead-referrer`.
- Expected boundary: the account sees only directly attributed leads and authorised functions.

### Sub-Agent invitation

- Select **Sub-Agent** without choosing a partner.
- Expected: **Parent partner is required**; submission is blocked with a clear validation message.
- Choose the test partner and submit again.
- Expected: the Sub-Agent is linked to that parent partner and cannot see other partner organisations.

## Invitation delivery and first login

### Magic-link path

- Choose **Magic link**, send the test invitation, and open the received one-time link.
- Expected: the link authenticates the invited account once and lands on the correct role portal.
- Expected: an expired or reused link fails safely and can be resent by the Owner.

### Temporary-password first-login gate

- Choose **Temporary password**, save the generated password securely, and sign in as the invited account.
- Expected: **Temporary-password first-login gate** blocks the rest of the portal.
- Change the password, then sign out and sign in with the new password.
- Expected: the gate clears only after a successful password change; the temporary password no longer works.

## Client portal invitation from a lead

1. Sign in as Owner and open **Leads**.
2. Search for the dedicated test lead and open it.
3. In **Client portal access**, verify the authorised email and send the link.
4. Expected: the invite retains the source lead attribution and the client lands in `/client`.
5. Expected: the client cannot open internal Owner, Partner, Contractor, or Lead Referrer routes.

## Calendar and booking rules

### Standalone booking

- Sign in as a permitted Partner, Contractor, or Lead Referrer and open **Book the Owner**.
- Choose **Standalone booking — no CRM record**, enter the person/business name and a brief purpose, then submit.
- Expected: no lead/client/deal is required; the Owner receives a pending request with the supplied name and purpose.

### Presentation: 14:00–20:00 SAST only

- Try Presentation against the slot before 14:00 and the slot after 20:00.
- Expected: Presentation is unavailable/blocked for both.
- Try Presentation against the slot within 14:00–20:00.
- Expected: the request is accepted as pending Owner approval.

### All other booking types: any published time

- For each published slot, request Urgent, Submission, Submission Update, or Consultation when that type is published.
- Expected: the time-of-day rule does not block these categories; only slot publication, availability, and Owner approval apply.

## Owner event creation

- Sign in as Owner, open **Calendar**, and create an internal event at a non-Presentation time without linking a task.
- Expected: the event saves successfully and no null-task error is shown.
- Create a Presentation event outside 14:00–20:00.
- Expected: the UI and backend reject it consistently.

## Cleanup and evidence

- Capture screenshots of the four role choices, Sub-Agent parent validation, forced password-change gate, correct role landing, and each calendar boundary result.
- Deactivate all test users and cancel test bookings/events.
- Confirm activity/audit logs contain the invitation, activation, password change, resend (if tested), and deactivation actions.
