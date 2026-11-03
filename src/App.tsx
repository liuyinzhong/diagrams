import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./lib/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CodeEditor, type CodeEditorHandle, type EditorDiagnostic } from "./components/Editor/CodeEditor";
import { languageExtensionsFor } from "./components/Editor/languages";
import { findTableAtOffset } from "./lib/findTableAtOffset";
import { utf16ToUtf8Offset, utf8ToUtf16Offset } from "./lib/textOffsets";
import { basename } from "./lib/paths";
import { DiagramView } from "./components/DiagramView";
import { FileExplorer } from "./components/FileExplorer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { defaultContentFor, DIAGRAM_TYPES } from "./lib/diagramTypes";
import { parseSequence } from "./lib/sequence/parse";
import { layoutSequence } from "./lib/sequence/layout";
import { parseBpmn } from "./lib/bpmn/parse";
import { computeBpmnLayout } from "./lib/bpmn/canvasLayout";
import { parseArchitecture } from "./lib/architecture/parse";
import type { ArchCanvasLayout } from "./lib/architecture/layout";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { TabBar } from "./components/Toolbar/TabBar";
import { ImportSqlModal } from "./components/Toolbar/ImportSqlModal";
import { ConfirmDialog, type ConfirmButton } from "./components/ConfirmDialog";
import { exportSvg, exportPng, exportPdf } from "./lib/exportImage";
import {
  loadRankdir,
  saveRankdir,
  loadDetailLevel,
  saveDetailLevel,
  loadRecentFiles,
  addRecentFile,
  removeRecentFile,
  loadAutosave,
  saveAutosave,
} from "./lib/prefs";
import { saveSession } from "./lib/session";
import { useDbmlParser } from "./hooks/useDbmlParser";
import { useDiagramLayout } from "./hooks/useDiagramLayout";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useWorkerLayout } from "./hooks/useWorkerLayout";
import { useFileOperations } from "./hooks/useFileOperations";
import { useDocuments, type Doc } from "./hooks/useDocuments";
import { useTheme } from "./context/ThemeContext";
import type { DetailLevel } from "./types/layout";

function App() {
  const { theme } = useTheme();
  const docs = useDocuments(defaultContentFor("dbml"));
  const { activeDoc, activeId } = docs;
  const content = activeDoc.content;

  const [rankdir, setRankdir] = useState<"LR" | "RL" | "TB">(loadRankdir);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(loadDetailLevel);
  const [highlightedTable, setHighlightedTable] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const [autosave, setAutosave] = useState<boolean>(loadAutosave);
  const [isSaving, setIsSaving] = useState(false);
  const [explorerVisible, setExplorerVisible] = useState(true);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    buttons: ConfirmButton[];
  } | null>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only DBML uses the Rust parser; other types render client-side.
  const isDbml = activeDoc.type === "dbml";
  const { schema, parseError, isLoading } = useDbmlParser(isDbml ? content : "");
  // Kept current for the autocomplete extension, which reads it in an event
  // handler — update in an effect rather than during render (render must be pure).
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  const { layout, isLayouting: isDbmlLayouting } = useDiagramLayout(schema, rankdir, detailLevel);
  const fileOps = useFileOperations();
  const languageExtensions = useMemo(
    () => languageExtensionsFor(activeDoc.type, schemaRef),
    [activeDoc.type]
  );

  // Client-side diagram types parse off the debounced content so typing never
  // pays parse+layout per keystroke (DBML already debounces in useDbmlParser).
  const debouncedContent = useDebouncedValue(content, 150, activeDoc.id);

  // Sequence diagrams parse + layout entirely client-side.
  const seq = useMemo(() => {
    if (activeDoc.type !== "sequence") return null;
    const { ir, error } = parseSequence(debouncedContent);
    return { layout: layoutSequence(ir), error };
  }, [activeDoc.type, debouncedContent]);

  // BPMN diagrams parse + layout entirely client-side (custom SVG renderer).
  const bpmn = useMemo(() => {
    if (activeDoc.type !== "bpmn") return null;
    const { ir, error } = parseBpmn(debouncedContent);
    return { layout: computeBpmnLayout(ir), error };
  }, [activeDoc.type, debouncedContent]);

  // Architecture parses client-side but its dagre layout is heavy (hundreds of
  // ms at hundreds of nodes) → computed in the layout worker.
  const archParse = useMemo(() => {
    if (activeDoc.type !== "architecture") return null;
    return parseArchitecture(debouncedContent);
  }, [activeDoc.type, debouncedContent]);
  const archJob = useMemo(
    () => (archParse ? ({ kind: "arch", ir: archParse.ir } as const) : null),
    [archParse]
  );
  const { layout: archWorkerLayout, isLayouting: isArchLayouting } = useWorkerLayout(archJob);
  const arch = useMemo(() => {
    if (!archParse) return null;
    return {
      layout: (archWorkerLayout as ArchCanvasLayout | null),
      error: archParse.error,
    };
  }, [archParse, archWorkerLayout]);

  // Active diagram bounds (used by image export).
  const diagramW = isDbml ? layout.width : seq?.layout.width ?? bpmn?.layout.width ?? arch?.layout?.width ?? 0;
  const diagramH = isDbml ? layout.height : seq?.layout.height ?? bpmn?.layout.height ?? arch?.layout?.height ?? 0;

  // Unified parse-error for the toolbar across diagram types.
  const otherError = seq?.error ?? bpmn?.error ?? arch?.error ?? null;
  const activeError = isDbml
    ? parseError
    : otherError
      ? { message: otherError.message, span: null as [number, number] | null }
      : null;

  // Inline editor underline: DBML errors carry a char span; the client-side
  // parsers carry a 1-based line number.
  const editorDiagnostic = useMemo<EditorDiagnostic | null>(() => {
    if (isDbml) {
      return parseError ? { message: parseError.message, span: parseError.span } : null;
    }
    return otherError ? { message: otherError.message, line: otherError.line } : null;
  }, [isDbml, parseError, otherError]);

  const [dividerPos, setDividerPos] = useState(40);
  const [isDraggingDivider, setIsDraggingDivider] = useState(false);

  const rememberRecent = useCallback((path: string) => {
    setRecentFiles(addRecentFile(path));
  }, []);

  const handleContentChange = useCallback(
    (value: string) => {
      docs.updateContent(activeId, value);
    },
    [docs, activeId]
  );

  const handleOpen = useCallback(async () => {
    const result = await fileOps.openFile();
    if (result) {
      docs.openDoc(result.path, result.content);
      rememberRecent(result.path);
    }
  }, [fileOps, docs, rememberRecent]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      try {
        const content = await fileOps.readFile(path);
        if (content != null) {
          docs.openDoc(path, content);
          rememberRecent(path);
        }
      } catch {
        // The file was moved or deleted: drop it from the recents list.
        setRecentFiles(removeRecentFile(path));
        alert(`文件已不可用，已从最近文件中移除：\n${path}`);
      }
    },
    [fileOps, docs, rememberRecent]
  );

  const handleOpenExplorerFile = useCallback(async (path: string) => {
    const existing = docs.docs.find((doc) => doc.filePath === path);
    if (existing) { docs.setActive(existing.id); return; }
    try {
      const fileContent = await fileOps.readFile(path);
      if (fileContent != null) {
        docs.openDoc(path, fileContent);
        rememberRecent(path);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }, [docs, fileOps, rememberRecent]);

  const saveDoc = useCallback(
    async (doc: Doc): Promise<string | null> => {
      let saved: string | null;
      try {
        saved = await fileOps.saveFile(doc.content, doc.filePath, doc.diskContent);
      } catch (error) {
        alert(error instanceof Error ? error.message.replace("FILE_CHANGED:", "") : String(error));
        return null;
      }
      if (saved) {
        docs.markSaved(doc.id, saved, doc.content);
        rememberRecent(saved);
      }
      return saved;
    },
    [fileOps, docs, rememberRecent]
  );

  const handleSave = useCallback(() => saveDoc(activeDoc), [saveDoc, activeDoc]);

  const handleSaveAs = useCallback(async () => {
    const saved = await fileOps.saveFile(activeDoc.content, null);
    if (saved) {
      docs.markSaved(activeId, saved, activeDoc.content);
      rememberRecent(saved);
    }
  }, [fileOps, docs, activeId, activeDoc.content, rememberRecent]);

  // Close a tab, confirming first if it has unsaved changes.
  const requestCloseDoc = useCallback(
    (id: string) => {
      const doc = docs.docs.find((d) => d.id === id);
      if (!doc || !doc.isDirty) {
        docs.closeDoc(id);
        return;
      }
      const label = doc.filePath ? basename(doc.filePath) : "未命名";
      setConfirm({
        title: "未保存的更改",
        message: `“${label}”有未保存的更改。关闭前保存吗？`,
        buttons: [
          {
            label: "保存",
            variant: "primary",
            onClick: async () => {
              setConfirm(null);
              const saved = await saveDoc(doc);
              if (saved) docs.closeDoc(id);
            },
          },
          {
            label: "不保存",
            variant: "danger",
            onClick: () => {
              setConfirm(null);
              docs.closeDoc(id);
            },
          },
          { label: "取消", onClick: () => setConfirm(null) },
        ],
      });
    },
    [docs, saveDoc]
  );

  const handleExportSql = useCallback(
    async (dialect: string) => {
      try {
        const sql = await invoke<string>("generate_sql", {
          input: activeDoc.content,
          dialect,
        });
        await fileOps.exportSql(sql, dialect);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        alert(`导出失败：${msg}`);
      }
    },
    [fileOps, activeDoc.content]
  );

  const handleExportSvg = useCallback(() => {
    try {
      exportSvg(diagramW, diagramH);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`导出失败：${msg}`);
    }
  }, [diagramW, diagramH]);

  const handleExportPng = useCallback(async () => {
    try {
      await exportPng(diagramW, diagramH, theme.canvasBg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`导出失败：${msg}`);
    }
  }, [diagramW, diagramH, theme.canvasBg]);

  const handleExportPdf = useCallback(async () => {
    try {
      await exportPdf(diagramW, diagramH, theme.canvasBg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`导出失败：${msg}`);
    }
  }, [diagramW, diagramH, theme.canvasBg]);

  const applyImportedDbml = useCallback(
    (dbml: string) => {
      docs.replaceContent(activeId, dbml);
    },
    [docs, activeId]
  );

  const handleImportFile = useCallback(
    async (dialect: string) => {
      try {
        const sql = await fileOps.openSqlFile();
        if (sql == null) return;
        const dbml = await fileOps.importSql(sql, dialect);
        applyImportedDbml(dbml);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        alert(`导入失败：${msg}`);
      }
    },
    [fileOps, applyImportedDbml]
  );

  const handleImportSqlConfirm = useCallback(
    async (sql: string, dialect: string) => {
      try {
        const dbml = await fileOps.importSql(sql, dialect);
        applyImportedDbml(dbml);
        setShowImportModal(false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        alert(`导入失败：${msg}`);
      }
    },
    [fileOps, applyImportedDbml]
  );

  const toggleRankdir = useCallback(() => {
    setRankdir((prev) => {
      const next = prev === "LR" ? "RL" : prev === "RL" ? "TB" : "LR";
      saveRankdir(next);
      return next;
    });
  }, []);

  const handleCursorChange = useCallback(
    (offset: number) => {
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = setTimeout(() => {
        if (!schema) return;
        // CodeMirror reports UTF-16 offsets; parser spans are UTF-8 bytes.
        const tableName = findTableAtOffset(schema, utf16ToUtf8Offset(content, offset));
        setHighlightedTable(tableName);
      }, 100);
    },
    [schema, content]
  );

  const handleNavigateToSource = useCallback(
    (spanRange: [number, number]) => {
      // Parser spans are UTF-8 bytes; CodeMirror expects UTF-16 offsets.
      editorRef.current?.scrollToOffset(utf8ToUtf16Offset(content, spanRange[0]));
    },
    [content]
  );

  const toggleDetailLevel = useCallback(() => {
    setDetailLevel((prev) => {
      const levels: DetailLevel[] = ["full", "keys-only", "name-only"];
      const idx = levels.indexOf(prev);
      const next = levels[(idx + 1) % levels.length];
      saveDetailLevel(next);
      return next;
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        // With Shift held, e.key for a letter is uppercase ("S"), so compare
        // case-insensitively — otherwise Cmd/Ctrl+Shift+S (Save As) never fires.
        const k = e.key.toLowerCase();
        if (k === "o") {
          e.preventDefault();
          handleOpen();
        } else if (k === "s" && e.shiftKey) {
          e.preventDefault();
          handleSaveAs();
        } else if (k === "s") {
          e.preventDefault();
          handleSave();
        } else if (k === "t") {
          e.preventDefault();
          docs.newDoc("dbml", defaultContentFor("dbml"));
        } else if (k === "w") {
          e.preventDefault();
          requestCloseDoc(activeId);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpen, handleSave, handleSaveAs, requestCloseDoc, docs, activeId]);

  const toggleAutosave = useCallback(() => {
    setAutosave((prev) => {
      saveAutosave(!prev);
      return !prev;
    });
  }, []);

  // Autosave: debounced write of dirty, file-backed docs. "未命名" buffers have
  // no path so they're covered by session persistence instead.
  const autosaveInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autosave) return;
    const pending = docs.docs.filter(
      (d) => d.filePath && d.isDirty && d.diskContent != null && d.externalContent === undefined && !autosaveInFlight.current.has(d.id)
    );
    if (pending.length === 0) return;
    const t = setTimeout(async () => {
      setIsSaving(true);
      for (const d of pending) {
        autosaveInFlight.current.add(d.id);
        try {
          await fileOps.saveFile(d.content, d.filePath!, d.diskContent);
          docs.markSaved(d.id, d.filePath!, d.content);
        } catch {
          // Ignore autosave failures; manual save still surfaces errors.
        } finally {
          autosaveInFlight.current.delete(d.id);
        }
      }
      setIsSaving(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [autosave, docs.docs, docs, fileOps]);

  // Poll all file-backed tabs, including inactive ones. The state update checks
  // the latest buffer again after each asynchronous disk read.
  const monitoredDocsRef = useRef(docs.docs);
  useEffect(() => { monitoredDocsRef.current = docs.docs; }, [docs.docs]);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        await Promise.all(monitoredDocsRef.current.filter((d) => d.filePath && !d.needsLoad && !autosaveInFlight.current.has(d.id)).map(async (d) => {
          try {
            const latest = await fileOps.readFile(d.filePath!);
            if (!cancelled && latest != null && !autosaveInFlight.current.has(d.id)) docs.reconcileDisk(d.id, d.filePath!, latest, d.diskContent);
          } catch {
            // A file may be temporarily unavailable during an external save.
          }
        }));
      } finally { running = false; }
    };
    void check();
    const timer = setInterval(check, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [fileOps.readFile, docs.reconcileDisk]);

  // Persist the open tabs (debounced) so the session survives restarts.
  useEffect(() => {
    const t = setTimeout(() => saveSession(docs.docs, activeId), 500);
    return () => clearTimeout(t);
  }, [docs.docs, activeId]);

  // Latest docs / saveDoc for the once-registered window-close listener.
  const docsRef = useRef(docs.docs);
  const saveDocRef = useRef(saveDoc);
  useEffect(() => {
    docsRef.current = docs.docs;
    saveDocRef.current = saveDoc;
  }, [docs.docs, saveDoc]);

  // Intercept the app window close to confirm unsaved changes.
  useEffect(() => {
    // Tauri-only API; skip when running in a plain browser.
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const win = getCurrentWindow();
    win
      .onCloseRequested((event) => {
        const dirty = docsRef.current.filter((d) => d.isDirty);
        if (dirty.length === 0) return; // nothing unsaved → allow close
        event.preventDefault();
        setConfirm({
          title: "未保存的更改",
          message: `有 ${dirty.length} 个文档包含未保存的更改。`,
          buttons: [
            {
              label: "全部保存",
              variant: "primary",
              onClick: async () => {
                for (const d of dirty) {
                  const saved = await saveDocRef.current(d);
                  if (!saved) {
                    // A save dialog was cancelled → abort the close.
                    setConfirm(null);
                    return;
                  }
                }
                setConfirm(null);
                await win.destroy();
              },
            },
            {
              label: "放弃更改",
              variant: "danger",
              onClick: async () => {
                setConfirm(null);
                await win.destroy();
              },
            },
            { label: "取消", onClick: () => setConfirm(null) },
          ],
        });
      })
      .then((fn) => {
        // Registration resolves async: if the effect was cleaned up first,
        // unlisten immediately instead of leaking a duplicate handler.
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // On startup, hydrate restored clean docs by reading their files from disk.
  useEffect(() => {
    const restored = docs.docs.filter((d) => d.needsLoad && d.filePath);
    if (restored.length === 0) return;
    (async () => {
      for (const d of restored) {
        try {
          const c = await fileOps.readFile(d.filePath!);
          docs.hydrateDoc(d.id, c ?? "");
        } catch {
          docs.closeDoc(d.id);
          setRecentFiles(removeRecentFile(d.filePath!));
        }
      }
    })();
    // Run once on mount against the restored snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDividerMouseDown = useCallback(() => {
    setIsDraggingDivider(true);
  }, []);

  // Track the divider drag on window so releasing the button outside the app
  // window still ends the drag.
  useEffect(() => {
    if (!isDraggingDivider) return;
    const handleMove = (e: MouseEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setDividerPos(Math.max(15, Math.min(85, pct)));
    };
    const handleUp = () => setIsDraggingDivider(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDraggingDivider]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        overflow: "hidden",
        backgroundColor: theme.canvasBg,
      }}
    >
      <Toolbar
        explorerVisible={explorerVisible}
        onToggleExplorer={() => setExplorerVisible((visible) => !visible)}
        parseError={activeError}
        isLoading={isLoading || isDbmlLayouting || isArchLayouting}
        stats={
          isDbml && schema
            ? `${schema.tables.length} 张表，${schema.refs.length} 个关系`
            : activeDoc.type === "sequence" && seq
              ? `${seq.layout.participants.length} 个参与者，${seq.layout.messages.length} 条消息`
              : activeDoc.type === "bpmn" && bpmn
                ? `${bpmn.layout.nodes.length} 个节点，${bpmn.layout.edges.length} 条流程`
                : activeDoc.type === "architecture" && arch?.layout
                  ? `${arch.layout.nodes.length} 个节点，${arch.layout.edges.length} 条连接`
                  : DIAGRAM_TYPES[activeDoc.type].label
        }
        filePath={activeDoc.filePath}
        isDirty={activeDoc.isDirty}
        recentFiles={recentFiles}
        autosave={autosave}
        isSaving={isSaving}
        showSqlActions={isDbml}
        onOpen={handleOpen}
        onOpenRecent={handleOpenRecent}
        onToggleAutosave={toggleAutosave}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onExportSql={handleExportSql}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        onExportPdf={handleExportPdf}
        onImportFile={handleImportFile}
        onPasteSql={() => setShowImportModal(true)}
      />
      <TabBar
        docs={docs.docs}
        activeId={activeId}
        onSelect={docs.setActive}
        onClose={requestCloseDoc}
        onNew={(type) => docs.newDoc(type, defaultContentFor(type))}
      />
      {activeDoc.externalContent !== undefined && (
        <div style={{ padding: "8px 14px", background: theme.toolbarBg, color: theme.toolbarText, display: "flex", alignItems: "center", gap: 12, fontSize: 12 }}>
          <span>文件已在外部修改，本地也有未保存的更改。自动保存已暂停。</span>
          <button onClick={() => docs.resolveExternal(activeId, true)}>加载外部版本（放弃本地更改）</button>
          <button onClick={() => docs.resolveExternal(activeId, false)}>保留本地修改（自动保存开启时将覆盖文件）</button>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <FileExplorer activePath={activeDoc.filePath} onOpen={handleOpenExplorerFile} visible={explorerVisible} onClose={() => setExplorerVisible(false)} />
        <div ref={workspaceRef} style={{ display: "flex", flex: 1, minWidth: 0, overflow: "hidden" }}>
        <div
          style={{
            width: `${dividerPos}%`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CodeEditor
            ref={editorRef}
            key={`${activeId}-${activeDoc.editorKey}`}
            initialValue={content}
            onChange={handleContentChange}
            onCursorChange={handleCursorChange}
            languageExtensions={languageExtensions}
            syncValue={content}
            diagnostic={editorDiagnostic}
          />
        </div>
        {/* Signature: the panel divider is a precision tick-rule — the one
            control that adjusts the layout looks like a measuring instrument.
            Ticks are painted with a repeating gradient; a knurled grip sits at
            center and lights up in the accent while dragging. */}
        <div
          onMouseDown={handleDividerMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整编辑器和画布大小"
          style={{
            position: "relative",
            width: 9,
            backgroundColor: theme.toolbarBg,
            borderLeft: `1px solid ${theme.toolbarBorder}`,
            borderRight: `1px solid ${theme.toolbarBorder}`,
            cursor: "col-resize",
            flexShrink: 0,
            backgroundImage: `repeating-linear-gradient(to bottom, ${
              isDraggingDivider ? theme.dividerActive : theme.dividerHover
            } 0, ${isDraggingDivider ? theme.dividerActive : theme.dividerHover} 1px, transparent 1px, transparent 7px)`,
            backgroundPosition: "center",
            backgroundSize: "5px 100%",
            backgroundRepeat: "no-repeat",
            transition: isDraggingDivider ? "none" : "background-image 0.15s",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 5,
              height: 26,
              borderRadius: 3,
              backgroundColor: isDraggingDivider ? theme.dividerActive : theme.divider,
              boxShadow: `0 0 0 3px ${theme.toolbarBg}`,
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ErrorBoundary key={`${activeId}-${activeDoc.type}`}>
          <DiagramView
            type={activeDoc.type}
            schema={schema}
            layout={layout}
            rankdir={rankdir}
            onToggleRankdir={toggleRankdir}
            detailLevel={detailLevel}
            onToggleDetailLevel={toggleDetailLevel}
            highlightedTable={highlightedTable}
            onNavigateToSource={handleNavigateToSource}
            storageKey={`${activeDoc.filePath ?? `untitled-${activeId}`}::${rankdir}`}
            seqLayout={seq?.layout ?? null}
            bpmnLayout={bpmn?.layout ?? null}
            archLayout={arch?.layout ?? null}
          />
          </ErrorBoundary>
        </div>
        </div>
      </div>
      {showImportModal && (
        <ImportSqlModal
          onImport={handleImportSqlConfirm}
          onClose={() => setShowImportModal(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          buttons={confirm.buttons}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

export default App;
