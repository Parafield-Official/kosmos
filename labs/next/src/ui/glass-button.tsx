import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Liquid } from "./liquid-control";
import { clearLiquidSettings, frostSettings, type LiquidSettings } from "./liquid-settings";

type GlassButtonBase = {
  shape?: "circle" | "pill";
  variant?: "default" | "discord" | "success" | "clear" | "frost";
  settings?: LiquidSettings;
  children?: ReactNode;
  className?: string;
};

type GlassButtonProps =
  | (GlassButtonBase & { as?: "button" } & Omit<ComponentPropsWithoutRef<"button">, "className">)
  | (GlassButtonBase & { as: "a" } & Omit<ComponentPropsWithoutRef<"a">, "className">);

export function GlassButton(props: GlassButtonProps) {
  const { shape = "pill", variant = "default", className, children, settings } = props;
  const glassSettings =
    settings ??
    (variant === "clear" ? clearLiquidSettings : variant === "frost" ? frostSettings : undefined);

  const classes = [
    "glass-btn",
    `glass-btn-${shape}`,
    variant !== "default" ? `glass-btn-${variant}` : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (props.as === "a") {
    const { as: _as, shape: _shape, variant: _variant, className: _className, children: _children, settings: _settings, ...rest } = props;
    return (
      <Liquid
        as="a"
        shape={shape}
        className={classes}
        settings={glassSettings}
        {...rest}
      >
        {children}
      </Liquid>
    );
  }

  const { as: _as, shape: _shape, variant: _variant, className: _className, children: _children, settings: _settings, ...rest } = props;
  return (
    <Liquid
      as="button"
      shape={shape}
      className={classes}
      settings={glassSettings}
      {...rest}
    >
      {children}
    </Liquid>
  );
}
