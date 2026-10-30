# Native client example

This Expo development-build example uses the system browser, Authorization Code, S256 PKCE, and the OIDC UserInfo endpoint. It is a public native client and contains no client secret. The app reads the profile from UserInfo and does not persist tokens.

## Register a native application

In the developer center, create a Native application and request openid, profile, and email. Register the exact callback URI printed by the app, normally org.dt.identitydemo:///callback for an iOS or Android development build. Register org.dt.identitydemo:///logout as a post-logout URI. Complete the required HTTPS homepage, privacy, and terms URLs, then submit the app for review.

For production, use verified HTTPS app/universal links where supported and register the exact deployed URI.

## Run

Install Node.js 24, npm 11, and the iOS or Android native toolchain. Then:

```sh
cd examples/native
npm install
export EXPO_PUBLIC_OIDC_ISSUER=https://identity.example
export EXPO_PUBLIC_OIDC_CLIENT_ID=approved-native-client-id
npx expo prebuild
npx expo run:android
# Or: npx expo run:ios
```

Replace the issuer and public client ID. Use a development build because the app needs its registered URI scheme; Expo Go returns a different callback URI. Approve the native app before testing login. Native applications must not use a client secret.
