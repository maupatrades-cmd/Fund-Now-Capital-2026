# Client backend PR 5 - Path B attribution

Path B means a lead referrer belongs to a partner. The lead is attributed to both the individual
lead referrer and the parent referral partner. The parent relationship is validated again when the
owner locks attribution. A lead referrer sees only their own leads; the partner sees its child
membership and attribution history; the owner retains full control.

This PR is independently based on Build 74A. Logical merge order is identity, intake, invitations,
then attribution. The later R100 reward PR consumes only owner-locked attribution.