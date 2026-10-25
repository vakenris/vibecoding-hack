"use client";
import type { AppState } from "@/lib/domain";
import { Achievements } from "../achievements";
type Props = { state: AppState };
export function ProfileScreen({ state }: Props) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Мой профиль</h1>
          <p className="lead">{state.profile.name}</p>
        </div>
      </div>
      {state.profile.goals && (
        <p className="profile-goal">{state.profile.goals}</p>
      )}
      <Achievements earned={state.achievements} />
    </>
  );
}
