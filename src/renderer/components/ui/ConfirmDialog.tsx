import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "./Button";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((result: boolean) => {
    setState((current) => {
      if (current) current.resolve(result);
      return null;
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  // Escape 关闭 + 打开时聚焦确认按钮
  useEffect(() => {
    if (!state) return;
    confirmRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <div className="dialog-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={state.title ?? "确认"}>
            <h3 className="dialog-title">{state.title ?? "确认操作"}</h3>
            <p className="dialog-message">{state.message}</p>
            <div className="dialog-actions">
              <Button ref={confirmRef} onClick={() => close(false)}>
                {state.cancelLabel ?? "取消"}
              </Button>
              <Button variant={state.danger ? "danger" : "primary"} onClick={() => close(true)}>
                {state.confirmLabel ?? "确认"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
