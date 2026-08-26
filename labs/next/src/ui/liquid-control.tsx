import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { liquidVars } from "./liquid-settings";

export function Liquid({
  as: Tag = "button",
  shape = "pill",
  className,
  children,
  style,
  ...rest
}: {
  as?: "button" | "div" | "span";
  shape?: "circle" | "pill";
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
} & HTMLAttributes<HTMLElement>) {
  const classes = ["liquid", `liquid-${shape}`, className].filter(Boolean).join(" ");

  return (
    <Tag className={classes} style={{ ...liquidVars(), ...style }} {...rest}>
      <span className="liquid-lens" aria-hidden="true">
        <span className="liquid-fill" />
        <span className="liquid-refract" />
        <span className="liquid-spec" />
        <span className="liquid-rim" />
      </span>
      <span className="liquid-content">{children}</span>
    </Tag>
  );
}
