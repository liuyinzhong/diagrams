// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ColumnRow } from "./ColumnRow";

describe("ColumnRow", () => {
  it("reports hovering across the whole field row without displaying its note inline", () => {
    const onHover = vi.fn();
    const { container, queryByText } = render(<svg><ColumnRow
      column={{ name: "status", type: "int", note: "状态备注", isPk: false, isUnique: false, isNullable: true, isIncremental: false, defaultValue: null, check: null, spanRange: [0, 0] }}
      index={0} y={0} isFk={false} onHover={onHover}
    /></svg>);
    expect(queryByText("状态备注")).toBeNull();
    fireEvent.mouseEnter(container.querySelector("rect")!, { clientX: 25, clientY: 15 });
    expect(onHover).toHaveBeenCalledWith("status", 25, 15);
    fireEvent.mouseLeave(container.querySelector("rect")!, { clientX: 26, clientY: 16 });
    expect(onHover).toHaveBeenLastCalledWith(null, 26, 16);
  });
});
