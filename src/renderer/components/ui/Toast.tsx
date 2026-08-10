import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

type ShowToast = (message: string, type?: ToastType) => void;

const ToastContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

const TOAST_DURATION = 3200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const show = useCallback<ShowToast>((message, type = "info") => {
    const id = ++idRef.current;
    setToasts((current) => [...current, { id, type, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, TOAST_DURATION);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
