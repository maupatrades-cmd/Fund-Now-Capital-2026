# Calling from the CRM: Twilio setup (for the Director)

The CRM can call consultants, agents, clients and leads from your PC, with your headset. Until the steps below are done,
the **Call** button shows "Calling is not set up yet": nothing is dialled and nothing is charged.

Calls are **not recorded**. The person you call sees the Fund Now Capital number you set below.

## What it costs

Twilio charges per minute for calls to South African mobiles and landlines, plus a monthly fee for the phone number.
Prices change, so check Twilio's current **South Africa voice pricing** page before you start. You pay Twilio directly;
the CRM adds no extra cost.

## Steps

1. **Twilio account.** Sign up at twilio.com, or use the account you are setting up for WhatsApp (A13). Upgrade it from
   trial to a paid account; trial accounts can only call numbers you have verified.
2. **A South African phone number.** In the Twilio Console go to *Phone Numbers → Buy a number*, choose South Africa,
   and pick a number with **Voice**.
   - South African numbers need a **regulatory bundle**: Twilio asks for proof of the business address and company
     documents (CIPC). Approval can take a few days.
   - **Until the number is approved,** you can use your own cell number as the caller ID. Add it under
     *Phone Numbers → Verified Caller IDs*. Twilio will call or SMS you a code to confirm it.
3. **Allow calls to South Africa.** Console → *Voice → Settings → Geo permissions* → tick **South Africa**.
4. **An API key.** Console → *Account → API keys & tokens* → *Create API key* (type **Standard**). Copy the **SID**
   (starts with `SK`) and the **Secret**. The Secret is shown only once.
5. **A TwiML App** (this tells Twilio where the CRM's call instructions are). Console → *Voice → TwiML → TwiML Apps* →
   *Create new TwiML App*:
   - Friendly name: `FNC CRM calls`.
   - **Voice Request URL:** `https://hvxruwkgmhjoypepffgv.supabase.co/functions/v1/twilio-voice-twiml`, method
     **HTTP POST**.
   - **Status Callback URL:** `https://hvxruwkgmhjoypepffgv.supabase.co/functions/v1/twilio-voice-status`, method
     **HTTP POST**.
   - Save, and copy the App **SID** (starts with `AP`).
6. **Add the secrets in Supabase.** Go to *Edge Functions → Secrets* and add these six (names exactly as written):

   | Name | Value |
   |---|---|
   | `TWILIO_ACCOUNT_SID` | Your Account SID (starts with `AC`; Console home page) |
   | `TWILIO_AUTH_TOKEN` | Your Auth Token (Console home page) |
   | `TWILIO_API_KEY_SID` | The API key SID from step 4 (`SK…`) |
   | `TWILIO_API_KEY_SECRET` | The API key Secret from step 4 |
   | `TWILIO_TWIML_APP_SID` | The TwiML App SID from step 5 (`AP…`) |
   | `TWILIO_CALLER_ID` | The number people see, in the form `+27…` (your Twilio number, or your verified cell) |

7. **Test.** Refresh the CRM. Open a field consultant's agent file and press **Call**. Your browser asks to use the
   microphone the first time: click **Allow**. You'll see *Ringing…*, then *In call* with a timer. After you hang up,
   you can type a short note; the call also appears under **Calls** and in the activity log.

## If something goes wrong

- **"Calling is not set up yet":** one of the six secrets is missing or misspelt.
- **"Your browser blocked the microphone":** click the padlock next to the web address, set Microphone to *Allow*, then
  reload.
- **Twilio says the call was not allowed:** check step 3 (Geo permissions). On a trial account, also check that the
  number you're calling is verified.
- **"There is no phone number on file":** add the person's cell number on their agent file or the lead or client, then
  try again.
