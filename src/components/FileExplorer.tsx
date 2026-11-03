import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "../context/ThemeContext";
import { DIAGRAM_TYPES, ENABLED_TYPES } from "../lib/diagramTypes";
import { basename } from "../lib/paths";
import { loadExplorerRoot, saveExplorerRoot } from "../lib/prefs";
import { isTauri } from "../lib/tauri";
import { IconFolderOpen, IconAutosave, IconClose } from "./icons";

interface DiagramFile {
  name: string;
  path: string;
  relativePath: string;
}
interface DirectoryScan { files: DiagramFile[]; skippedDirectories: number }
interface TreeNode { name: string; key: string; directories: Map<string, TreeNode>; files: DiagramFile[] }
interface ExplorerProps { activePath: string | null; onOpen: (path: string) => void; visible?: boolean; onClose?: () => void }

const extensions = ENABLED_TYPES.flatMap((type) => DIAGRAM_TYPES[type].fileExts);

function makeTree(files: DiagramFile[]): TreeNode {
  const root: TreeNode = { name: "", key: "", directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.relativePath.split("/");
    let node = root;
    for (const name of parts.slice(0, -1)) {
      if (!node.directories.has(name)) node.directories.set(name, { name, key: `${node.key}/${name}`, directories: new Map(), files: [] });
      node = node.directories.get(name)!;
    }
    node.files.push(file);
  }
  return root;
}

export function FileExplorer({ activePath, onOpen, visible = true, onClose }: ExplorerProps) {
  const { theme } = useTheme();
  const [root, setRoot] = useState<string | null>(loadExplorerRoot);
  const [view, setView] = useState<"tree" | "flat">("tree");
  const [refreshKey, setRefreshKey] = useState(0);
  const [scan, setScan] = useState<DirectoryScan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const chooseFolder = useCallback(async () => {
    try {
      const selected = await invoke<string | null>("pick_directory");
      if (selected) { saveExplorerRoot(selected); setRoot(selected); setScan(null); setExpanded(new Set()); setRefreshKey((v) => v + 1); setError(null); }
    } catch (e) { setError(`选择文件夹失败：${String(e)}`); }
  }, []);

  useEffect(() => {
    if (!root || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await invoke<DirectoryScan>("scan_directory", { path: root, extensions });
        if (!cancelled) { setScan(result); setError(null); }
      } catch (e) {
        if (!cancelled) setError(`无法扫描目录：${String(e)}`);
      } finally {
        if (!cancelled) timer = setTimeout(load, 10000);
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [root, refreshKey, visible]);

  const tree = useMemo(() => makeTree(scan?.files ?? []), [scan]);
  const buttonStyle: React.CSSProperties = { border: 0, background: "transparent", color: theme.toolbarTextMuted, cursor: "pointer", padding: 5, borderRadius: 4, display: "inline-flex", alignItems: "center" };
  const toggle = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const fileButton = (file: DiagramFile, depth = 0, showPath = false) => (
    <button key={file.path} onClick={() => onOpen(file.path)} title={file.relativePath}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: `6px 10px 6px ${12 + depth * 14}px`, border: 0, textAlign: "left", cursor: "pointer", background: file.path === activePath ? theme.controlHoverBg : "transparent", color: file.path === activePath ? theme.toolbarAccent : theme.toolbarText, fontSize: 12 }}>
      <span aria-hidden style={{ width: 14, color: theme.toolbarTextMuted }}>·</span>
      <span style={{ overflow: "hidden", minWidth: 0 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>{showPath && <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: theme.toolbarTextMuted, fontSize: 11 }}>{file.relativePath}</span>}</span>
    </button>
  );
  const renderTree = (node: TreeNode, depth: number): React.ReactNode => <div role="group">
    {[...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name)).map((dir) => <div key={dir.key}>
      <button onClick={() => toggle(dir.key)} aria-expanded={expanded.has(dir.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: `6px 10px 6px ${12 + depth * 14}px`, border: 0, textAlign: "left", cursor: "pointer", background: "transparent", color: theme.toolbarText, fontSize: 12 }}>
        <span aria-hidden style={{ width: 14, color: theme.toolbarTextMuted }}>{expanded.has(dir.key) ? "▾" : "▸"}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir.name}</span>
      </button>
      {expanded.has(dir.key) && renderTree(dir, depth + 1)}
    </div>)}
    {node.files.map((file) => fileButton(file, depth))}
  </div>;

  return <aside aria-label="资源管理器" style={{ width: 240, minWidth: 200, flexShrink: 0, display: visible ? "flex" : "none", flexDirection: "column", background: theme.toolbarBg, borderRight: `1px solid ${theme.toolbarBorder}`, color: theme.toolbarText, fontSize: 12 }}>
    <div style={{ height: 38, display: "flex", alignItems: "center", padding: "0 12px", gap: 6, borderBottom: `1px solid ${theme.toolbarBorder}` }}>
      <strong style={{ flex: 1, fontWeight: 600 }}>资源管理器</strong>
      <button style={buttonStyle} onClick={chooseFolder} disabled={!isTauri()} title="选择文件夹" aria-label="选择文件夹"><IconFolderOpen /></button>
      {root && <button style={buttonStyle} onClick={() => setRefreshKey((v) => v + 1)} title="刷新文件列表" aria-label="刷新文件列表"><IconAutosave /></button>}
      {onClose && <button style={buttonStyle} onClick={onClose} title="收起资源管理器" aria-label="收起资源管理器"><IconClose /></button>}
    </div>
    {!root ? <div style={{ padding: "24px 16px", color: theme.toolbarTextMuted, lineHeight: 1.8 }}>
      <div>{isTauri() ? "选择文件夹，浏览其中的图形文件。" : "请在桌面应用中使用资源管理器。"}</div>
      {isTauri() && <button onClick={chooseFolder} style={{ ...buttonStyle, color: theme.toolbarAccent, padding: "8px 0" }}>选择文件夹</button>}
    </div> : <>
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 10px", borderBottom: `1px solid ${theme.toolbarBorder}` }}>
        <span title={root} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: theme.toolbarTextMuted }}>{basename(root) || root}</span>
        <button onClick={() => setView("tree")} aria-pressed={view === "tree"} style={{ ...buttonStyle, color: view === "tree" ? theme.toolbarAccent : theme.toolbarTextMuted }}>树结构</button>
        <button onClick={() => setView("flat")} aria-pressed={view === "flat"} style={{ ...buttonStyle, color: view === "flat" ? theme.toolbarAccent : theme.toolbarTextMuted }}>平铺</button>
      </div>
      <div style={{ overflow: "auto", flex: 1, padding: "6px 0" }}>
        {!scan && !error && <div style={{ padding: "6px 12px", color: theme.toolbarTextMuted }}>正在扫描…</div>}
        {scan && scan.files.length === 0 && <div style={{ padding: "6px 12px", color: theme.toolbarTextMuted }}>没有支持的图形文件</div>}
        {scan && (view === "tree" ? renderTree(tree, 0) : scan.files.map((file) => fileButton(file, 0, true)))}
      </div>
      {!!scan?.skippedDirectories && <div role="status" style={{ padding: "8px 12px", color: theme.warningText }}>部分目录或文件无法读取，结果可能不完整。</div>}
    </>}
    {error && <div role="alert" style={{ color: theme.errorText, padding: "8px 12px", overflowWrap: "anywhere" }}>{error}</div>}
  </aside>;
}
