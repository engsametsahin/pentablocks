import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "pentablocks.session-token.v1";

export function getSessionToken() {
  return SecureStore.getItemAsync(SESSION_KEY);
}

export function saveSessionToken(token: string) {
  return SecureStore.setItemAsync(SESSION_KEY, token);
}

export function clearSessionToken() {
  return SecureStore.deleteItemAsync(SESSION_KEY);
}
