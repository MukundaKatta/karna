# Apple App Store Submission Guide — Karna

Complete step-by-step guide for submitting Karna iOS to the App Store via EAS.

## Prerequisites

- [ ] Active Apple Developer Program membership ($99/year) — enroll at [developer.apple.com](https://developer.apple.com/programs/)
- [ ] EAS CLI installed: `npm install -g eas-cli`
- [ ] Logged in to EAS: `eas login` (account: `mukundakatta`)
- [ ] Node.js 20+ and pnpm 9+

## Step 1 — Gather Apple Credentials

You need the following from your Apple Developer account:

| Value | Where to find it |
|---|---|
| **Apple ID email** | Your developer account email |
| **Apple Team ID** | developer.apple.com → Membership → Team ID (10-char) |
| **App Store Connect App ID (ascAppId)** | appstoreconnect.apple.com → My Apps → + → New App → then check the numeric ID in URL |
| **ASC API Key** (recommended) | App Store Connect → Users and Access → Keys → Generate (Issuer ID + Key ID + download .p8) |

## Step 2 — Create the App in App Store Connect

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. My Apps → + → **New App**
3. Fill in:
   - **Platform**: iOS
   - **Name**: Karna — AI Assistant
   - **Primary Language**: English (U.S.)
   - **Bundle ID**: `com.karna.mobile` (register at developer.apple.com → Certificates, IDs & Profiles → Identifiers if needed)
   - **SKU**: `karna-mobile-001`
   - **User Access**: Full Access

4. Copy the numeric **App ID** shown in the URL and paste it into `eas.json` → `submit.production.ios.ascAppId`

## Step 3 — Fill in Placeholders

Edit `apps/mobile/eas.json`:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "your-apple-id@example.com",
      "ascAppId": "1234567890",
      "appleTeamId": "ABCDE12345",
      ...
    }
  }
}
```

Edit `apps/mobile/store.config.json` and replace all `REPLACE_WITH_*` placeholders in the `review` block (contact info and demo credentials).

## Step 4 — Prepare Assets

### App Icon
- `assets/icon.png` → **1024×1024 px** PNG, no transparency, no rounded corners

### Screenshots (required for App Store listing)
Create in `assets/store/screenshots/`:

- **iPhone 6.7"** (required): 1290×2796 — at least 3, up to 10
- **iPhone 6.5"** (required): 1242×2688
- **iPhone 5.5"** (still required by some submissions): 1242×2208
- **iPad Pro 12.9"** (required because `supportsTablet: true`): 2048×2732

Current repo-ready screenshot sets:
- `assets/store/screenshots/iphone-6.5/`
- `assets/store/screenshots/ipad-13/`

Tip: Use `expo start --ios` to run in simulator, take screenshots via `Cmd+S`.
Important: the majority of screenshots must show the actual app UI in use. Avoid logo slides, splash-only screens, or promo art that hides the real product.

## Step 5 — Build the iOS Binary

From repo root:

```bash
cd apps/mobile
eas build --platform ios --profile production
```

EAS will:
1. Prompt to generate/reuse Distribution Certificate and Provisioning Profile
2. Build in the cloud (~15-25 min)
3. Output a `.ipa` file

## Step 6 — Submit to App Store

```bash
eas submit --platform ios --profile production --latest
```

This uploads the `.ipa` to App Store Connect. Processing takes ~10-30 min.

## Step 7 — Complete App Store Listing

In App Store Connect → your app → **App Store** tab:

1. **Version Information**:
   - Promotional text (170 chars)
   - Description (from `store.config.json`)
   - Keywords (100 chars)
   - Support URL, Marketing URL
   - Upload screenshots

2. **App Privacy** (left sidebar) → click **Get Started**:
   - Data collected: **User Content** (voice recordings), **Identifiers** (User ID), **Usage Data**
   - Linked to user: Yes (for sync)
   - Used for tracking: No

3. **Age Rating** → complete questionnaire (most answers "None")

4. **App Review Information**:
   - Sign-in required: **No** if you are using the hosted review gateway
   - Notes: explain that the app connects to the hosted review gateway by default
   - Mention that notification permissions are optional and can be enabled later from Settings
   - If you switch back to account-based access later, provide a demo account that works on first launch
   - Use the response template in `apps/mobile/APP_REVIEW_RESPONSE.md` when replying to the rejection in Resolution Center

5. **Version Release**: choose manual or automatic

## Step 8 — Submit for Review

1. Select the build you uploaded (under **Build** section, choose the processed version)
2. Click **Add for Review** → **Submit for Review**
3. Apple review typically takes 24–48 hours

## Common Rejection Reasons to Avoid

- **Guideline 5.1.1** (Privacy) — missing privacy policy URL ✓ already set
- **Guideline 2.1** (Performance) — app crashes or is incomplete
- **Guideline 4.2** (Minimum Functionality) — app is too thin / just a web wrapper
  - **Mitigation**: Karna has native voice recording, notifications, and offline state
- **Guideline 5.1.2** (Data Collection) — missing permission explanations ✓ all set
- **Missing demo account** for apps requiring sign-in ✓ provided

## Post-Submission

Monitor status in App Store Connect. Common statuses:
- **Waiting for Review** → Apple hasn't started yet
- **In Review** → Apple is testing (usually < 24h)
- **Pending Developer Release** → Approved, waiting for you to publish
- **Ready for Sale** → Live on App Store
- **Rejected** → See Resolution Center for feedback

## TestFlight (optional, recommended before production)

For beta testing before submission:

```bash
eas submit --platform ios --profile production --latest
```

Then in App Store Connect → TestFlight → add internal/external testers.

## Troubleshooting

| Issue | Fix |
|---|---|
| "Bundle ID not registered" | developer.apple.com → Identifiers → + → App IDs |
| "Invalid provisioning profile" | `eas credentials` → iOS → Remove → re-build |
| "ITSAppUsesNonExemptEncryption required" | Already set in `app.json` ✓ |
| Build fails on node_modules | Bump `eas.json` → `build.production.ios.resourceClass` to `m-large` |

## References

- [EAS Submit docs](https://docs.expo.dev/submit/ios/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)
