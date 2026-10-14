# Sign-in options: Google and phone (SMS)

Both are **off** until you flip the flags in `assets/js/config.js`:
```js
authGoogle: true,   // after Part 1
authPhone: true,    // after Part 2 (also enables "invite by mobile number" on the Members page)
```
Turn a flag on only after its provider works. Otherwise people get an error at sign-in.

Supabase project: `qqllbazrwfebpnqhdwox`. Dashboard: https://supabase.com/dashboard/project/qqllbazrwfebpnqhdwox

## Part 0: URL settings (once)
Supabase → **Authentication → URL Configuration**
- **Site URL:** `https://mmcminn034.github.io/elgin-catalog/`
- **Redirect URLs:** add `https://mmcminn034.github.io/elgin-catalog/**` (and `http://localhost:8765/**` if you test locally).

## Part 1: Continue with Google
### A. Google Cloud Console
1. Go to https://console.cloud.google.com/ and create (or pick) a project, e.g. "Rolling Oak Catalog".
2. **APIs & Services → OAuth consent screen** (now called **Google Auth Platform → Branding/Audience**):
   - User type **External**. App name "Rolling Oak Catalog", support email = your Gmail, developer contact email.
   - Authorized domain: `supabase.co` (and `github.io` if it asks for the app's home page domain).
   - Scopes: only the defaults `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`, so no Google verification is needed.
   - Audience: **Publish app** (In production). While it's in "Testing", only listed test users can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**, name "Rolling Oak (Supabase)".
   - **Authorized JavaScript origins:** `https://mmcminn034.github.io`
   - **Authorized redirect URIs:** `https://qqllbazrwfebpnqhdwox.supabase.co/auth/v1/callback`
   - Create, then copy the **Client ID** and **Client secret**.
### B. Supabase
4. **Authentication → Sign In / Providers → Google**: enable it, paste the Client ID and Client secret, then Save.
   (The "Callback URL" shown there must match the redirect URI above.)
5. Set `authGoogle: true` in `config.js` and push. Test: Sign in → **Continue with Google** → you return signed in.

Cost: free.
If you already signed in with email and the Google account uses the same verified email, Supabase links the two to the same user, so your collections carry over.

## Part 2: Phone (SMS code)
Supabase sends texts through an SMS provider. Twilio is the most common choice.
### A. Twilio
1. Sign up at https://www.twilio.com/try-twilio and verify your email and your own mobile number.
   - **Trial:** about $15 of free credit, but texts go **only to numbers you've verified** in Twilio, and each message carries a "Sent from your Twilio trial account" prefix. Good for testing yourself.
   - **Paid:** click *Upgrade* and add a card (minimum top-up about $20). Then anyone can receive codes.
2. **Buy a number** (Phone Numbers → Buy a number, US, SMS-capable): about **$1.15/month**.
3. **US carrier registration (required for US texting):** register the number. Either use **Toll-free verification** (buy a toll-free number instead, which is simplest for a hobby site, free to submit, takes a few days) or **A2P 10DLC** (Sole Proprietor brand, about $4 one-time plus about $15 campaign vetting, then about $2/month). Unregistered US traffic is blocked.
4. **Messaging → Services → Create Messaging Service** ("Rolling Oak sign-in", use case "Verify / 2FA"), then add your number to its Sender Pool. Copy the **Messaging Service SID** (starts with `MG…`).
5. From the Console home, copy the **Account SID** (`AC…`) and **Auth Token**.
### B. Supabase
6. **Authentication → Sign In / Providers → Phone**: enable it.
   - SMS provider **Twilio**. Paste the Account SID, Auth Token and **Message Service SID** (`MG…`).
   - Leave "Enable phone confirmations" on. OTP expiry around 300 s is fine, and the code length is 6.
   - Optional: the SMS message template, e.g. `Your Rolling Oak Catalog code is {{ .Code }}`.
7. **Authentication → Rate Limits**: the default SMS limit (about 30/hour per project) is fine. Supabase also enforces about 60 s between texts to one number, which matches the site's resend timer.
8. Set `authPhone: true` in `config.js` and push. Test: Sign in → enter your mobile → enter the 6-digit code.

### Costs (approximate, US, 2026)
| Item | Cost |
|---|---|
| Twilio number | ~$1.15/mo (toll-free ~$2.15/mo) |
| Each SMS code (US) | ~$0.008 + carrier fee ~$0.003–0.005 ≈ **$0.01–0.015** |
| A2P 10DLC (if not toll-free) | ~$4 brand + ~$15 vetting one-time, ~$2/mo campaign |
| Supabase phone auth | included in Free/Pro plans (you pay Twilio only) |
So 100 sign-ins a month costs about $3 including the number. Set a usage alert in Twilio (Billing → Usage triggers) to cap surprises.

Alternatives Supabase supports: MessageBird, Vonage, Textlocal, or Twilio Verify (the Twilio Verify service SID `VA…`, roughly $0.05 per verification, no number or registration needed). Twilio Verify is the easiest way to skip step 3.

## Phone invites
After running `supabase/migrations/002_phone_invites.sql`, owners can invite by mobile number on **Members**.
- No text is sent for an invite (to avoid SMS cost and spam), so tell the person to sign in with that number.
- On first sign-in, `accept_invites()` matches the user's **confirmed** phone (or email) from `auth.users` and adds them with the invited role.
- Profiles for users without an email get the display name "Member" (never derived from the phone number, because profiles are public). They can change it on the Profile page.
