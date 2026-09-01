import { createElement } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from "react";
import { liquidVars, type LiquidSettings } from "./liquid-settings";

type LiquidBase = {
  shape?: "circle" | "pill";
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  settings?: LiquidSettings;
};

type LiquidProps =
  | (LiquidBase & { as?: "button" } & ButtonHTMLAttributes<HTMLButtonElement>)
  | (LiquidBase & { as: "a" } & AnchorHTMLAttributes<HTMLAnchorElement>)
  | (LiquidBase & { as: "div" } & HTMLAttributes<HTMLDivElement>)
  | (LiquidBase & { as: "span" } & HTMLAttributes<HTMLSpanElement>);

export function Liquid(props: LiquidProps) {
  const {
    as: Tag = "button",
    shape = "pill",
    className,
    children,
    style,
    settings,
    ...rest
  } = props;

  const classes = ["liquid", `liquid-${shape}`, className].filter(Boolean).join(" ");

  return createElement(
    Tag,
    { className: classes, style: { ...liquidVars(settings), ...style }, ...rest },
    <>
      <span className="liquid-lens" aria-hidden="true">
        <span className="liquid-fill" />
        <span className="liquid-refract" />
        <span className="liquid-spec" />
        <span className="liquid-rim" />
      </span>
      <span className="liquid-content">{children}</span>
    </>,
  );
}
