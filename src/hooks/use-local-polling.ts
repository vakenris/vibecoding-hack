"use client";
import { useEffect, type RefObject } from "react";
import { RequestScope, requestJSON } from "@/lib/client-request";
import type { AppState } from "@/lib/domain";
import type { LocalSnapshot } from "@/lib/local/types";
export type LocalProfile = { state: AppState; local: LocalSnapshot };
export function useLocalPolling(
  enabled: boolean,
  busy: RefObject<boolean>,
  scope: RefObject<RequestScope>,
  onProfile: (profile: LocalProfile) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let current: ReturnType<RequestScope["begin"]> | undefined;
    async function refresh() {
      if (!active) return;
      if (!busy.current) {
        const ticket = scope.current.begin();
        current = ticket;
        try {
          const profile = await requestJSON<LocalProfile>("/api/local", {
            cache: "no-store",
            signal: AbortSignal.any([
              ticket.signal,
              AbortSignal.timeout(10000),
            ]),
          });
          if (active && ticket.isCurrent() && !busy.current) onProfile(profile);
        } catch {
          /* Transient reads retry on the next tick; writes report their own errors. */
        } finally {
          ticket.close();
        }
      }
      if (active) timer = setTimeout(refresh, 3000);
    }
    timer = setTimeout(refresh, 0);
    return () => {
      active = false;
      clearTimeout(timer);
      current?.cancel();
      current?.close();
    };
  }, [enabled, busy, scope, onProfile]);
}
