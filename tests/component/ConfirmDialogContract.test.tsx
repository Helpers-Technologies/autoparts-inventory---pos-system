// @vitest-environment jsdom
/**
 * The contract every confirmation dialog in the app depends on.
 *
 * There are 32 <ConfirmDialog> instances across 23 pages, and they guard the
 * actions a shop cannot undo: deleting an invoice permanently, applying a
 * stocktake to real stock, restoring a deleted invoice, settling a customer's
 * whole balance, wiping and restoring a backup. None of that wiring was
 * covered — the component itself had no test at all, so nothing stopped a
 * refactor from making Escape confirm instead of cancel, or from letting a
 * double-click fire the action twice.
 *
 * Testing the shared component once covers the mechanics of all 32 sites. What
 * it deliberately does NOT cover is what each site does afterwards; the
 * highest-stakes of those are pinned separately in destructive-dialogs.test.tsx.
 *
 * Every case here was verified by mutation: the corresponding line in
 * Dialog.tsx was broken on purpose and the test failed.
 *
 * TC-CONFIRM-001 through TC-CONFIRM-012
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { ConfirmDialog, Dialog } from "../../src/components/ui/Dialog";
import "@testing-library/jest-dom/vitest";

const onConfirm = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  onConfirm.mockClear();
  onClose.mockClear();
});
afterEach(() => cleanup());

function renderConfirm(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  return render(
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={onConfirm}
      title="حذف الفاتورة نهائيًا"
      message="لا يمكن التراجع عن هذا الإجراء."
      confirmText="حذف"
      cancelText="إلغاء"
      variant="danger"
      {...props}
    />,
  );
}

describe("a confirmation dialog only ever acts when confirmed — TC-CONFIRM", () => {
  it("TC-CONFIRM-001: a closed dialog renders nothing at all", () => {
    // Not merely hidden: pages mount these permanently with `open={!!target}`,
    // so a dialog that rendered while closed would put a live confirm button
    // in the tree for every page in the app.
    renderConfirm({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("حذف")).not.toBeInTheDocument();
  });

  it("TC-CONFIRM-002: opening one performs no action by itself", () => {
    renderConfirm();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("TC-CONFIRM-003: the cancel button closes without acting", async () => {
    const user = userEvent.setup();
    renderConfirm();
    await user.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("TC-CONFIRM-004: Escape closes without acting", async () => {
    // The reflex key. If this ever confirmed, a shop would destroy records by
    // dismissing a dialog they opened by mistake.
    const user = userEvent.setup();
    renderConfirm();
    await user.keyboard("{Escape}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("TC-CONFIRM-005: clicking the backdrop closes without acting", async () => {
    const user = userEvent.setup();
    const { baseElement } = renderConfirm();
    const backdrop = baseElement.querySelector(".fixed.inset-0 > .absolute.inset-0");
    expect(backdrop).toBeTruthy();
    await user.click(backdrop as Element);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("TC-CONFIRM-006: clicking inside the dialog body does not close or act", async () => {
    // The backdrop and the panel are siblings, so a click on the message must
    // not bubble into the backdrop's onClick.
    const user = userEvent.setup();
    renderConfirm();
    await user.click(screen.getByText("لا يمكن التراجع عن هذا الإجراء."));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("TC-CONFIRM-007: the confirm button acts exactly once, then closes", async () => {
    const user = userEvent.setup();
    renderConfirm();
    await user.click(screen.getByRole("button", { name: "حذف" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("TC-CONFIRM-008: a double-click on confirm does not act twice", async () => {
    // A shop on a slow PC double-clicks everything. Confirming twice would
    // delete two invoices, refund twice, or settle a balance into credit.
    // The real pages close on the first confirm, so the guard that matters is
    // that the dialog is gone before a second click can land.
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={onConfirm}
          message="تأكيد"
          confirmText="حذف"
        />
      );
    }
    render(<Harness />);
    await user.dblClick(screen.getByRole("button", { name: "حذف" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("TC-CONFIRM-009: the destructive action is reachable only through the labelled button", async () => {
    // Guards against a refactor that wires onConfirm onto the panel, the
    // header close button, or the title.
    const user = userEvent.setup();
    renderConfirm();
    await user.click(screen.getByRole("dialog"));
    await user.click(screen.getByText("حذف الفاتورة نهائيًا"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("TC-CONFIRM-010: a dangerous action is styled as dangerous, not as the ordinary primary", () => {
    // The colour is the only warning a cashier gets before an irreversible
    // action. `variant="danger"` has to reach the button.
    const { unmount } = renderConfirm({ variant: "danger" });
    const danger = screen.getByRole("button", { name: "حذف" }).className;
    unmount();
    renderConfirm({ variant: "primary" });
    const primary = screen.getByRole("button", { name: "حذف" }).className;
    expect(danger).not.toBe(primary);
  });

  it("TC-CONFIRM-011: the dialog announces itself as modal and names itself", () => {
    renderConfirm();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(
      "حذف الفاتورة نهائيًا",
    );
  });
});

describe("the dialog shell the confirmations are built on — TC-CONFIRM", () => {
  it("TC-CONFIRM-012: page scrolling is locked while open and restored on close", async () => {
    // A modal that leaves the body locked strands the app: every page behind
    // it becomes unscrollable with no visible cause.
    document.body.style.overflow = "auto";
    const { rerender } = render(
      <Dialog open onClose={onClose} title="عنوان">
        محتوى
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => {
      rerender(
        <Dialog open={false} onClose={onClose} title="عنوان">
          محتوى
        </Dialog>,
      );
    });
    expect(document.body.style.overflow).toBe("auto");
  });
});
