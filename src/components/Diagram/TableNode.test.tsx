// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TableNode } from "./TableNode";
import type { TableIR } from "../../types/schema";

describe("table title", () => {
  const table: TableIR = { name: "dev_bug", schema: null, alias: null, note: "缺陷bug表", columns: [], indexes: [], headerColor: null, spanRange: [0, 0] };
  it.each(["full", "box"] as const)("displays the table name and note in %s view", (lod) => {
    const { container } = render(<svg><TableNode table={table} layout={{ id: "dev_bug", x: 0, y: 0, width: 260, height: 44 }} fkColumns={new Set()} isSelected={false} onDragStart={() => {}} detailLevel="full" lod={lod} /></svg>);
    const text = [...container.querySelectorAll("text")];
    expect(text[0].textContent).toBe("dev_bug");
    expect(text[1].firstChild?.textContent).toBe("缺陷bug表");
  });
});
