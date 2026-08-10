import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "success" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ variant = "secondary", icon, children, className = "", ...props }, ref) {
    return (
      <button ref={ref} className={`button button-${variant} ${className}`} {...props}>
        {icon ? <span className="button-icon">{icon}</span> : null}
        <span>{children}</span>
      </button>
    );
  },
);
