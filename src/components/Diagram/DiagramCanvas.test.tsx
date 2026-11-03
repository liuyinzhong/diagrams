// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LayoutResult } from "../../types/layout";
import type { SchemaIR, TableIR } from "../../types/schema";
import { darkTheme } from "../../lib/themes";
import { DiagramCanvas } from "./DiagramCanvas";

const table = (name: string): TableIR => ({
  name, schema: null, alias: null, note: null, columns: [], indexes: [],
  headerColor: null, spanRange: [0, 0],
});
const schema: SchemaIR = {
  tables: [table("users"), table("orders"), table("other")],
  refs: [{ name: null, relation: "many_to_one", fromTable: "orders", fromSchema: null,
    fromColumns: [], toTable: "users", toSchema: null, toColumns: [], onDelete: null,
    onUpdate: null, spanRange: [0, 0] }],
  enums: [], tableGroups: [], notes: [], project: null,
};
const layout: LayoutResult = {
  nodes: new Map(["users", "orders", "other"].map((id, i) => [id, {
    id, x: i * 300, y: 0, width: 260, height: 44,
  }])),
  edges: [{ from: "orders", to: "users", fromColumn: "", toColumn: "", fromColumnIndex: 0,
    toColumnIndex: 0, relation: "many_to_one", fromSide: "left", toSide: "right",
    points: [{ x: 260, y: 22 }, { x: 300, y: 22 }] }],
  width: 900, height: 100,
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderCanvas() {
  const view = render(<DiagramCanvas schema={schema} layout={layout} rankdir="LR"
    onToggleRankdir={() => {}} detailLevel="full" onToggleDetailLevel={() => {}}
    highlightedTable={null} storageKey="selection-test" />);
  const svg = view.container.querySelector("svg[data-diagram-svg]")!;
  const background = svg.querySelector(".canvas-bg")!;
  const edge = svg.querySelector(".relationship-edge")!;
  const node = (name: string) => screen.getByText(name).parentElement!.parentElement!;
  const border = (name: string) => node(name).querySelector("rect")!;
  return { svg, background, edge, node, border };
}

describe("canvas selection", () => {
  it("keeps the selected table and relationship highlighted while panning, and clears on a background click", () => {
    const { svg, background, edge, node, border } = renderCanvas();
    fireEvent.mouseDown(node("users"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 10, clientY: 10 });
    expect(border("users").getAttribute("stroke")).toBe(darkTheme.tableBorderSelected);
    expect(node("other").getAttribute("style")).toContain("opacity: 0.25");
    expect(edge.querySelectorAll("path")[1].getAttribute("stroke")).toBe(darkTheme.edgeLineHover);

    fireEvent.mouseDown(background, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseMove(svg, { buttons: 1, clientX: 340, clientY: 320 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 340, clientY: 320 });
    expect(border("users").getAttribute("stroke")).toBe(darkTheme.tableBorderSelected);
    expect(node("other").getAttribute("style")).toContain("opacity: 0.25");
    expect(edge.querySelectorAll("path")[1].getAttribute("stroke")).toBe(darkTheme.edgeLineHover);

    fireEvent.mouseEnter(node("other"), { clientX: 350, clientY: 320 });
    expect(node("other").getAttribute("style")).toContain("opacity: 0.25");
    fireEvent.mouseLeave(node("other"));
    fireEvent.mouseDown(background, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.mouseUp(svg, { button: 0, clientX: 300, clientY: 300 });
    expect(border("users").getAttribute("stroke")).toBe(darkTheme.tableBorder);
    expect(node("other").getAttribute("style")).toContain("opacity: 1");
  });

  it("keeps a selected relationship when the pointer leaves the canvas during a pan", () => {
    const { svg, background, edge, node } = renderCanvas();
    fireEvent.mouseDown(edge.querySelector("path")!, { button: 0 });
    expect(edge.querySelectorAll("path")[1].getAttribute("stroke")).toBe(darkTheme.edgeLineHover);
    fireEvent.mouseDown(background, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.mouseMove(svg, { buttons: 1, clientX: 140, clientY: 120 });
    fireEvent.mouseLeave(svg, { clientX: 140, clientY: 120 });
    expect(edge.querySelectorAll("path")[1].getAttribute("stroke")).toBe(darkTheme.edgeLineHover);
    expect(node("other").getAttribute("style")).toContain("opacity: 0.25");
  });

});
