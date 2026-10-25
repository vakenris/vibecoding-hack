"use server";
import { headers } from "next/headers";
import * as account from "@/lib/server/account";
import { localMode } from "@/lib/config";
import { assertLocalRequest } from "@/lib/local/http";
import { actionResult } from "@/lib/http";

async function result<T>(operation: string, fn: () => Promise<T>) {
  return actionResult(operation, async () => {
    if (localMode()) {
      const incoming = await headers();
      const host = incoming.get("host") || "invalid";
      const protocol =
        incoming.get("x-forwarded-proto") === "https" ? "https" : "http";
      assertLocalRequest(
        new Request(`${protocol}://${host}`, { headers: incoming }),
        true,
      );
    }
    return fn();
  });
}
export async function loadState() {
  return result("profile.load", account.loadState);
}
export async function dispatchCommand(input: unknown) {
  return result("profile.command", () => account.dispatchCommand(input));
}
export async function authenticate(input: unknown) {
  return result("account.authenticate", () => account.authenticate(input));
}
export async function signOut() {
  return result("account.signOut", account.signOut);
}
export async function deleteAccount() {
  return result("account.delete", account.deleteAccount);
}
