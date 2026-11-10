import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="page-kicker">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children}
    </div>
  );
}
