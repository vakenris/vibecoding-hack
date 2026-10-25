"use client";
import { useRef, useEffect, type ReactNode } from "react";
import {
  Compass,
  GraduationCap,
  House,
  Users,
  Wallet,
  Leaf,
  X,
  LoaderCircle,
} from "lucide-react";
import { type CategoryId, categories } from "@/lib/domain";
import { BrandArt } from "./brand-art";
const icons = { Compass, GraduationCap, House, Users, Wallet };
export function Brand() {
  return (
    <div className="brand" role="img" aria-label="LifePilot">
      <span className="brand-mark">
        <BrandArt />
      </span>
      <span className="brand-name">
        <BrandArt variant="wordmark" />
      </span>
    </div>
  );
}
export function CategoryIcon({
  id,
  size = 22,
}: {
  id: CategoryId;
  size?: number;
}) {
  const Icon = icons[categories[id].icon as keyof typeof icons];
  return <Icon size={size} strokeWidth={1.6} />;
}
export function Tag({ id }: { id: CategoryId }) {
  return (
    <span
      className="tag"
      style={{ color: categories[id].color, background: categories[id].tint }}
    >
      {categories[id].name}
    </span>
  );
}
export function Spinner() {
  return <LoaderCircle className="spin" size={18} aria-hidden />;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <Leaf size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}
