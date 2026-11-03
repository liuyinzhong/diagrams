import { useSyncExternalStore } from "react";
import type { DetailLevel } from "../../types/layout";
import type { TransformStore } from "../../hooks/useViewTransform";
import { useTheme } from "../../context/ThemeContext";

interface ZoomControlsProps {
  store: TransformStore;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToScreen: () => void;
  // DBML-specific controls (optional so other diagram types can reuse zoom/fit).
  rankdir?: "LR" | "RL" | "TB";
  onToggleRankdir?: () => void;
  detailLevel?: DetailLevel;
  onToggleDetailLevel?: () => void;
  onResetLayout?: () => void;
}

// Subscribed to the live transform so the percentage tracks the gesture
// without re-rendering anything else.
function ZoomLabel({ store, color }: { store: TransformStore; color: string }) {
  const pct = useSyncExternalStore(store.subscribe, () =>
    Math.round(store.getTransform().scale * 100)
  );
  return (
    <span
      style={{
        color,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        minWidth: 38,
        textAlign: "center",
        userSelect: "none",
      }}
    >
      {pct}%
    </span>
  );
}

const DETAIL_LABELS: Record<DetailLevel, string> = {
  full: "全部",
  "keys-only": "键",
  "name-only": "名称",
};

export function ZoomControls({
  store,
  onZoomIn,
  onZoomOut,
  onFitToScreen,
  rankdir,
  onToggleRankdir,
  detailLevel,
  onToggleDetailLevel,
  onResetLayout,
}: ZoomControlsProps) {
  const { theme } = useTheme();

  const btnStyle: React.CSSProperties = {
    background: theme.controlBg,
    border: `1px solid ${theme.controlBorder}`,
    color: theme.controlText,
    width: 28,
    height: 28,
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "var(--font-mono)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };

  const hover = (e: React.MouseEvent, enter: boolean) => {
    (e.target as HTMLElement).style.backgroundColor = enter
      ? theme.controlHoverBg
      : theme.controlBg;
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 12,
        right: 12,
        display: "flex",
        gap: 4,
        alignItems: "center",
        backgroundColor: theme.toolbarBg,
        border: `1px solid ${theme.toolbarBorder}`,
        borderRadius: 6,
        padding: "4px 6px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <button
        onClick={onFitToScreen}
        style={btnStyle}
        title="适应屏幕"
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
      >
        {"⊡"}
      </button>
      <button
        onClick={onZoomOut}
        style={btnStyle}
        title="缩小"
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
      >
        -
      </button>
      <ZoomLabel store={store} color={theme.toolbarTextMuted} />
      <button
        onClick={onZoomIn}
        style={btnStyle}
        title="放大"
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
      >
        +
      </button>
      {onToggleRankdir && rankdir && (
        <>
          <div style={{ width: 1, height: 20, backgroundColor: theme.toolbarBorder, margin: "0 2px" }} />
          <button
            onClick={onToggleRankdir}
            style={{ ...btnStyle, width: "auto", padding: "0 6px", fontSize: 10 }}
            title={`布局：${rankdir === "LR" ? "从左到右" : rankdir === "RL" ? "从右到左" : "从上到下"}`}
            onMouseEnter={(e) => hover(e, true)}
            onMouseLeave={(e) => hover(e, false)}
          >
            {rankdir}
          </button>
        </>
      )}
      {onToggleDetailLevel && detailLevel && (
        <button
          onClick={onToggleDetailLevel}
          style={{ ...btnStyle, width: "auto", padding: "0 6px", fontSize: 10 }}
          title={`显示详情：${DETAIL_LABELS[detailLevel]}`}
          onMouseEnter={(e) => hover(e, true)}
          onMouseLeave={(e) => hover(e, false)}
        >
          {DETAIL_LABELS[detailLevel]}
        </button>
      )}
      {onResetLayout && (
        <button
          onClick={onResetLayout}
          style={{ ...btnStyle, width: "auto", padding: "0 6px", fontSize: 10 }}
          title="重置布局（撤销手动定位）"
          onMouseEnter={(e) => hover(e, true)}
          onMouseLeave={(e) => hover(e, false)}
        >
          重置
        </button>
      )}
    </div>
  );
}
