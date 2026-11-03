// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDocuments } from "./useDocuments";

describe("external file updates", () => {
  beforeEach(() => localStorage.clear());

  it("reloads clean files and ignores stale reads after a save", () => {
    const { result } = renderHook(() => useDocuments(""));
    act(() => result.current.openDoc("a.dbml", "original"));
    const id = result.current.activeId;
    act(() => result.current.reconcileDisk(id, "a.dbml", "external", "original"));
    expect(result.current.activeDoc.content).toBe("external");
    expect(result.current.activeDoc.isDirty).toBe(false);
    act(() => result.current.reconcileDisk(id, "a.dbml", "stale", "original"));
    expect(result.current.activeDoc.content).toBe("external");
  });

  it("preserves unsaved edits until a conflict is resolved", () => {
    const { result } = renderHook(() => useDocuments(""));
    act(() => result.current.openDoc("a.dbml", "original"));
    const id = result.current.activeId;
    act(() => result.current.updateContent(id, "local"));
    act(() => result.current.reconcileDisk(id, "a.dbml", "external", "original"));
    expect(result.current.activeDoc.content).toBe("local");
    expect(result.current.activeDoc.externalContent).toBe("external");
    act(() => result.current.resolveExternal(id, false));
    expect(result.current.activeDoc).toMatchObject({ content: "local", diskContent: "external", isDirty: true, externalContent: undefined });
    act(() => result.current.reconcileDisk(id, "a.dbml", "new external", "external"));
    act(() => result.current.resolveExternal(id, true));
    expect(result.current.activeDoc).toMatchObject({ content: "new external", diskContent: "new external", isDirty: false, externalContent: undefined });
  });
});
