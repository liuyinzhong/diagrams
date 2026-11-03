// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileExplorer } from "./FileExplorer";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/tauri", () => ({ isTauri: () => true }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });
beforeEach(() => localStorage.clear());

describe("资源管理器", () => {
  it("选择目录、展开子目录并打开受支持的文件", async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const path = (args as { path?: string } | undefined)?.path;
      if (command === "pick_directory") return "D:\\models";
      if (command === "scan_directory" && path === "D:\\models") return {
        files: [{ name: "dev.dbml", path: "D:\\models\\dev\\dev.dbml", relativePath: "dev/dev.dbml" }],
        skippedDirectories: 0,
      };
      throw new Error("unexpected command");
    });
    const onOpen = vi.fn();
    render(<FileExplorer activePath={null} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "dev" }));
    fireEvent.click(await screen.findByRole("button", { name: "dev.dbml" }));
    expect(onOpen).toHaveBeenCalledWith("D:\\models\\dev\\dev.dbml");
    expect(invoke).toHaveBeenCalledWith("scan_directory", expect.objectContaining({ extensions: ["dbml", "seq", "bpmn", "arch"] }));
    fireEvent.click(screen.getByRole("button", { name: "平铺" }));
    expect(screen.getByText("dev/dev.dbml")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "dev" })).toBeNull();
  });

  it("目录读取失败时展示错误", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "pick_directory") return "D:\\models";
      throw new Error("访问被拒绝");
    });
    render(<FileExplorer activePath={null} onOpen={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("访问被拒绝"));
  });

  it("收起后重新展开时保留所选目录和文件", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "pick_directory") return "D:\\models";
      if (command === "scan_directory") return { files: [{ name: "a.dbml", path: "D:\\models\\a.dbml", relativePath: "a.dbml" }], skippedDirectories: 0 };
      throw new Error("unexpected command");
    });
    const onOpen = vi.fn();
    const { rerender } = render(<FileExplorer activePath={null} onOpen={onOpen} visible />);
    fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    await screen.findByRole("button", { name: "a.dbml" });
    rerender(<FileExplorer activePath={null} onOpen={onOpen} visible={false} />);
    expect(screen.queryByRole("button", { name: "a.dbml" })).toBeNull();
    rerender(<FileExplorer activePath={null} onOpen={onOpen} visible />);
    expect(screen.getByRole("button", { name: "a.dbml" })).toBeTruthy();
  });

  it("重新打开资源管理器时恢复上次选择的目录", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "pick_directory") return "D:\\models";
      if (command === "scan_directory") return { files: [{ name: "a.dbml", path: "D:\\models\\a.dbml", relativePath: "a.dbml" }], skippedDirectories: 0 };
      throw new Error("unexpected command");
    });
    const first = render(<FileExplorer activePath={null} onOpen={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    await screen.findByRole("button", { name: "a.dbml" });
    first.unmount();
    vi.mocked(invoke).mockClear();
    render(<FileExplorer activePath={null} onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: "a.dbml" });
    expect(invoke).toHaveBeenCalledWith("scan_directory", expect.objectContaining({ path: "D:\\models" }));
    expect(invoke).not.toHaveBeenCalledWith("pick_directory");
  });

  it("缓存目录不可用时提示错误并允许重新选择", async () => {
    localStorage.setItem("diagrams-explorer-root", "D:\\missing");
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "scan_directory") throw new Error("目录不存在");
      if (command === "pick_directory") return null;
      throw new Error("unexpected command");
    });
    render(<FileExplorer activePath={null} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("目录不存在"));
    expect(screen.getByRole("button", { name: "选择文件夹" })).toBeTruthy();
  });
});
