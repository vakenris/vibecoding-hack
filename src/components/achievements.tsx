import { Check, CheckCheck, Compass, GitBranch, Trophy } from "lucide-react";
import { achievementCatalog } from "@/lib/domain";
const icons = { Check, CheckCheck, Compass, GitBranch, Trophy };
export function Achievements({ earned }: { earned: string[] }) {
  return (
    <section aria-label="Достижения">
      <h2 className="spaced-heading">Маленькие победы</h2>
      <div className="achievement-grid">
        {achievementCatalog.map((item) => {
          const Icon = icons[item.icon];
          const unlocked = earned.includes(item.id);
          return (
            <article
              className={`achievement ${unlocked ? "earned" : ""}`}
              key={item.id}
              style={
                {
                  "--achievement-color": item.color,
                  "--achievement-tint": item.tint,
                } as React.CSSProperties
              }
            >
              <div className="achievement-circle" aria-hidden="true">
                <Icon size={34} strokeWidth={1.6} />
                {unlocked && (
                  <span className="achievement-check">
                    <Check size={13} />
                  </span>
                )}
              </div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <small>{unlocked ? "Получено" : "Пока закрыто"}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
