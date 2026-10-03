// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectionUpgradeGate } from "../../src/components/layout/ProjectionUpgradeGate";

type Listener = (status: {
  state: "NOT_REQUIRED" | "REQUIRED" | "PREPARING" | "BUILDING" | "VALIDATING" | "FINALIZING" | "COMPLETE" | "FAILED" | "INTERRUPTED";
  percent: number;
  processedRecords: number;
  totalRecords: number;
  entity?: string;
  chunk?: number;
  chunks?: number;
  errorCode?: string;
}) => void;
let listener: Listener | undefined;
const getStatus = vi.fn();
const start = vi.fn();

beforeEach(() => {
  listener = undefined;
  getStatus.mockReset();
  start.mockReset();
  Object.defineProperty(window, "desktopAPI", {
    configurable: true,
    value: {
      projection: {
        getStatus,
        start,
        onProgress: (cb: Listener) => { listener = cb; return () => { listener = undefined; }; },
      },
    },
  });
});

afterEach(cleanup);

describe("ProjectionUpgradeGate", () => {
  it("does not display migration UI for a current projection", async () => {
    getStatus.mockResolvedValue({ state: "NOT_REQUIRED", percent: 100, processedRecords: 10, totalRecords: 10 });
    render(<ProjectionUpgradeGate enabled><div>Dashboard</div></ProjectionUpgradeGate>);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("shows real worker progress before exposing dependent UI", async () => {
    getStatus.mockResolvedValue({ state: "REQUIRED", percent: 0, processedRecords: 0, totalRecords: 200_000 });
    start.mockResolvedValue({ state: "BUILDING", percent: 2, processedRecords: 0, totalRecords: 200_000 });
    render(<ProjectionUpgradeGate enabled><div>Dashboard</div></ProjectionUpgradeGate>);
    expect(await screen.findByTestId("projection-upgrade-screen")).toBeInTheDocument();
    await waitFor(() => expect(start).toHaveBeenCalledOnce());
    act(() => listener?.({ state: "BUILDING", percent: 45, processedRecords: 90_000, totalRecords: 200_000, entity: "salesInvoices", chunk: 90, chunks: 200 }));
    expect(screen.getByText("45٪")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    act(() => listener?.({ state: "COMPLETE", percent: 100, processedRecords: 200_000, totalRecords: 200_000 }));
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });

  it("keeps canonical-data reassurance visible and offers Retry after failure", async () => {
    getStatus.mockResolvedValue({ state: "FAILED", percent: 31, processedRecords: 100, totalRecords: 300, errorCode: "test" });
    start.mockResolvedValue({ state: "PREPARING", percent: 0, processedRecords: 0, totalRecords: 300 });
    render(<ProjectionUpgradeGate enabled><div>Dashboard</div></ProjectionUpgradeGate>);
    expect(await screen.findByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
    expect(screen.getByText(/بيانات المبيعات والمخزون الأصلية لم تتغير/)).toBeInTheDocument();
  });
});
