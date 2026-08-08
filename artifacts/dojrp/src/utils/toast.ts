// ─────────────────────────────────────────────────────────────────────────────
// utils/toast.ts  —  Toast notification helpers
//
// Thin wrappers around sonner's toast() with consistent call signatures.
// Use showSuccess / showError / showLoading across the app instead of calling
// sonner directly so the styling stays uniform.
// ─────────────────────────────────────────────────────────────────────────────
import { toast } from "sonner";

export const showSuccess = (message: string) => {
  toast.success(message);
};

export const showError = (message: string) => {
  toast.error(message);
};

export const showLoading = (message: string) => {
  return toast.loading(message);
};

export const dismissToast = (toastId: string | number) => {
  toast.dismiss(toastId);
};
