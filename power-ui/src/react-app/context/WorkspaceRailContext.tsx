import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { ROUTES } from "../router/paths";

export type WorkspaceRailContextValue = {
  previewActive: boolean;
  setPreviewActive: (active: boolean) => void;
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  collapseRail: () => void;
  /** 文件预览中且侧栏展开时可全屏 */
  canFullscreen: boolean;
};

const WorkspaceRailContext = createContext<WorkspaceRailContextValue | null>(null);

const ROOT_FULLSCREEN_CLASS = "power-workspace-preview-fullscreen";

function syncRootFullscreenClass(active: boolean) {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }
  root.classList.toggle(ROOT_FULLSCREEN_CLASS, active);
}

export function WorkspaceRailProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [previewActive, setPreviewActive] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const onChatRoute = location.pathname === ROUTES.root || location.pathname === "/";

  useEffect(() => {
    if (!onChatRoute) {
      setPreviewActive(false);
      setFullscreen(false);
      setRailOpen(true);
    }
  }, [onChatRoute]);

  useEffect(() => {
    syncRootFullscreenClass(fullscreen && onChatRoute);
    return () => {
      syncRootFullscreenClass(false);
    };
  }, [fullscreen, onChatRoute]);

  useEffect(() => {
    if (!previewActive || !railOpen) {
      setFullscreen(false);
    }
  }, [previewActive, railOpen]);

  const canFullscreen = previewActive && railOpen && onChatRoute;

  const toggleFullscreen = useCallback(() => {
    if (!canFullscreen) {
      return;
    }
    setFullscreen((current) => !current);
  }, [canFullscreen]);

  const collapseRail = useCallback(() => {
    setFullscreen(false);
    setRailOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      previewActive,
      setPreviewActive,
      railOpen,
      setRailOpen,
      fullscreen,
      toggleFullscreen,
      collapseRail,
      canFullscreen,
    }),
    [canFullscreen, collapseRail, fullscreen, previewActive, railOpen, toggleFullscreen],
  );

  return <WorkspaceRailContext.Provider value={value}>{children}</WorkspaceRailContext.Provider>;
}

export function useWorkspaceRail(): WorkspaceRailContextValue {
  const ctx = useContext(WorkspaceRailContext);
  if (!ctx) {
    throw new Error("useWorkspaceRail must be used within WorkspaceRailProvider");
  }
  return ctx;
}

/** 非对话页或未挂载 Provider 时的空操作占位 */
export function useWorkspaceRailOptional(): WorkspaceRailContextValue | null {
  return useContext(WorkspaceRailContext);
}
