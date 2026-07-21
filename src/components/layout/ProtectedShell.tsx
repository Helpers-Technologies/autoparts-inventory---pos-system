import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../store/AuthContext";
import { AppLayout } from "./AppLayout";
import { useToast } from "../ui/Toast";
import { hasPermission } from "../../lib/permissions";
import { useFeatures } from "../../lib/useFeatures";
import type { FeatureKey } from "../../lib/features";
import type { UserPermissions } from "../../types";

export function ProtectedShell({
  children,
  permission,
  permissionAction = "view",
  ownerOnly,
  feature,
}: {
  children: React.ReactNode;
  permission?: keyof UserPermissions;
  permissionAction?: string;
  ownerOnly?: boolean;
  feature?: FeatureKey;
}) {
  const { auth, currentUser } = useAuth();
  const { isEnabled } = useFeatures();
  const loc = useLocation();
  const toast = useToast();

  if (!auth.isAuthenticated || !currentUser) {
    return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  }

  // Module disabled by the license package or hidden by the owner — keep the
  // route unreachable even via a direct URL.
  if (feature && !isEnabled(feature)) {
    return <Navigate to="/" replace />;
  }

  if (currentUser.role !== "owner") {
    if (ownerOnly) {
      setTimeout(() => toast.error("ليس لديك صلاحية", "هذه الصفحة مخصصة للمدير فقط"), 0);
      return <Navigate to="/" replace />;
    }
    if (permission && !hasPermission(currentUser, permission, permissionAction)) {
      setTimeout(() => toast.error("ليس لديك صلاحية", "لا تملك صلاحية لفتح هذه الصفحة"), 0);
      return <Navigate to="/" replace />;
    }
  }

  return <AppLayout>{children}</AppLayout>;
}
