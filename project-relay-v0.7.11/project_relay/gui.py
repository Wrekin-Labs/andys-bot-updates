from __future__ import annotations

import json
import tkinter as tk
import webbrowser
from tkinter import filedialog, messagebox, ttk

from . import __version__
from .approvals import ApprovalStore
from .audit import AuditLog
from .discovery import discover_devices
from .enrollment import request_pairing_code
from .updater import get_release, is_newer, prepare_self_update
from .owner_full_control import status as owner_status, set_local as set_owner_full_control
from .root_policy import local_list_roots, local_add_root, local_remove_root


class RelayWindow(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Project Relay {__version__}")
        self.geometry("920x560")
        self.minsize(760, 460)
        self.store = ApprovalStore()
        self._build()
        self.refresh_all()
        self.after(2000, self.poll_approvals)

    def _build(self):
        header = ttk.Frame(self, padding=12)
        header.pack(fill="x")
        ttk.Label(header, text="Project Relay", font=("Segoe UI", 18, "bold")).pack(side="left")
        ttk.Label(header, text="Local approval console").pack(side="left", padx=14)
        ttk.Button(header, text="Refresh", command=self.refresh_all).pack(side="right")
        ttk.Button(header, text="Check updates", command=self.check_updates).pack(side="right", padx=(0, 8))
        ttk.Button(header, text="Pair account", command=self.pair_account).pack(side="right", padx=(0, 8))

        tabs = self.tabs = ttk.Notebook(self)
        tabs.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.devices_tab = ttk.Frame(tabs, padding=10)
        self.approvals_tab = ttk.Frame(tabs, padding=10)
        self.audit_tab = ttk.Frame(tabs, padding=10)
        self.settings_tab = ttk.Frame(tabs, padding=10)
        tabs.add(self.devices_tab, text="Devices")
        tabs.add(self.approvals_tab, text="Approvals")
        tabs.add(self.audit_tab, text="Audit")
        tabs.add(self.settings_tab, text="Local settings")

        self.device_tree = ttk.Treeview(self.devices_tab, columns=("name", "kind", "status", "id"), show="headings")
        for col, title, width in (("name", "Device", 240), ("kind", "Type", 100), ("status", "Status", 100), ("id", "Device ID", 390)):
            self.device_tree.heading(col, text=title)
            self.device_tree.column(col, width=width, anchor="w")
        self.device_tree.pack(fill="both", expand=True)

        self.approval_tree = ttk.Treeview(self.approvals_tab, columns=("action", "device", "summary", "id"), show="headings")
        for col, title, width in (("action", "Action", 150), ("device", "Device", 180), ("summary", "What will happen", 330), ("id", "Approval ID", 220)):
            self.approval_tree.heading(col, text=title)
            self.approval_tree.column(col, width=width, anchor="w")
        self.approval_tree.pack(fill="both", expand=True)
        row = ttk.Frame(self.approvals_tab)
        row.pack(fill="x", pady=(8, 0))
        ttk.Button(row, text="Approve selected", command=self.approve_selected).pack(side="right")
        ttk.Label(row, text="Approval authorises only the exact action shown; it cannot be reused for different arguments.").pack(side="left")

        self.audit_text = tk.Text(self.audit_tab, height=10, wrap="word", state="disabled")
        self.audit_text.pack(fill="both", expand=True)

        owner_box = ttk.LabelFrame(self.settings_tab, text="Owner Full Control", padding=10)
        owner_box.pack(fill="x", pady=(0, 12))
        self.owner_status_var = tk.StringVar(value="Checking...")
        ttk.Label(owner_box, textvariable=self.owner_status_var).pack(side="left")
        ttk.Button(owner_box, text="Enable locally", command=self.enable_owner_control).pack(side="right")
        ttk.Button(owner_box, text="Revoke", command=self.disable_owner_control).pack(side="right", padx=(0, 8))

        roots_box = ttk.LabelFrame(self.settings_tab, text="Extra approved filesystem roots", padding=10)
        roots_box.pack(fill="both", expand=True)
        ttk.Label(
            roots_box,
            text="These roots expand normal CommandPort file access. They can only be changed locally on this workstation.",
            wraplength=760,
        ).pack(anchor="w", pady=(0, 8))
        self.roots_list = tk.Listbox(roots_box, height=8)
        self.roots_list.pack(fill="both", expand=True)
        root_buttons = ttk.Frame(roots_box)
        root_buttons.pack(fill="x", pady=(8, 0))
        ttk.Button(root_buttons, text="Add folder...", command=self.add_approved_root).pack(side="right")
        ttk.Button(root_buttons, text="Remove selected", command=self.remove_approved_root).pack(side="right", padx=(0, 8))

    def refresh_all(self):
        self.refresh_devices()
        self.refresh_approvals()
        self.refresh_audit()
        self.refresh_settings()

    def refresh_devices(self):
        self.device_tree.delete(*self.device_tree.get_children())
        for d in discover_devices():
            self.device_tree.insert("", "end", values=(d.name, d.kind, d.status, d.device_id))

    def poll_approvals(self):
        try:
            self.refresh_approvals()
        except (OSError, ValueError):
            self.tabs.tab(self.approvals_tab, text="Approvals (refresh unavailable)")
        finally:
            self.after(2000, self.poll_approvals)

    def refresh_approvals(self):
        records = self.store.pending()
        selected = self.approval_tree.selection()
        self.approval_tree.delete(*self.approval_tree.get_children())
        for r in records:
            self.approval_tree.insert("", "end", iid=r.approval_id, values=(r.action, r.device_id, r.summary, r.approval_id))
        for item in selected:
            if self.approval_tree.exists(item):
                self.approval_tree.selection_add(item)
        self.tabs.tab(self.approvals_tab, text=f"Approvals ({len(records)})")

    def refresh_audit(self):
        ok, count = AuditLog().verify()
        value = json.dumps({"chain_valid": ok, "entries": count}, indent=2)
        self.audit_text.configure(state="normal")
        self.audit_text.delete("1.0", "end")
        self.audit_text.insert("1.0", value)
        self.audit_text.configure(state="disabled")

    def refresh_settings(self):
        state = owner_status()
        enabled = bool(state.get("enabled"))
        self.owner_status_var.set(
            "Enabled — remote owner administration allowed"
            if enabled
            else "Disabled — remote owner administration blocked"
        )
        self.roots_list.delete(0, "end")
        for root in local_list_roots().get("roots", []):
            self.roots_list.insert("end", root)

    def enable_owner_control(self):
        yes = messagebox.askyesno(
            "Enable Owner Full Control?",
            "This allows the OAuth-linked account owner to use Project Relay's owner administration tools on this workstation. "
            "Normal customer/local approval mode remains separate. You can revoke this here at any time.\n\nEnable Owner Full Control?",
        )
        if not yes:
            return
        set_owner_full_control(True)
        self.refresh_settings()

    def disable_owner_control(self):
        yes = messagebox.askyesno(
            "Revoke Owner Full Control?",
            "Remote owner administration will be blocked immediately on this workstation.\n\nRevoke it now?",
        )
        if not yes:
            return
        set_owner_full_control(False)
        self.refresh_settings()

    def add_approved_root(self):
        selected = filedialog.askdirectory(title="Choose an extra Project Relay approved root")
        if not selected:
            return
        try:
            local_add_root(selected)
        except (OSError, ValueError) as exc:
            messagebox.showerror("Project Relay", f"Could not add approved root.\n\n{exc}")
            return
        self.refresh_settings()

    def remove_approved_root(self):
        selected = self.roots_list.curselection()
        if not selected:
            messagebox.showinfo("Project Relay", "Select an approved root first.")
            return
        path = str(self.roots_list.get(selected[0]))
        if not messagebox.askyesno(
            "Remove approved root?",
            f"Remove this extra approved root?\n\n{path}",
        ):
            return
        try:
            local_remove_root(path)
        except (OSError, ValueError) as exc:
            messagebox.showerror("Project Relay", f"Could not remove approved root.\n\n{exc}")
            return
        self.refresh_settings()

    def check_updates(self):
        try:
            release = get_release(channel="beta")
        except Exception as exc:
            messagebox.showerror("Project Relay", f"Could not check for updates.\n\n{exc}")
            return

        if not release:
            messagebox.showinfo("Project Relay", "No published beta release was found.")
            return

        version = str(release.get("version") or "unknown")
        notes = str(release.get("notes") or "")
        download_url = str(release.get("download_url") or "")
        if is_newer(version):
            message = f"Project Relay {version} is available.\n\n{notes}"
            if download_url:
                message += "\n\nA verified download is published for this release."
            else:
                message += "\n\nThe download package has not been published yet."
            if download_url and messagebox.askyesno(
                "Project Relay update",
                message + "\n\nDownload, verify and install it now? Project Relay will close briefly and reopen.",
            ):
                try:
                    path = prepare_self_update(release)
                    messagebox.showinfo(
                        "Project Relay update",
                        f"Verified update staged:\n\n{path}\n\nProject Relay will now close, install the update, and reopen automatically.",
                    )
                    self.after(150, self.destroy)
                except Exception as exc:
                    messagebox.showerror(
                        "Project Relay",
                        f"Update installation could not be staged.\n\n{exc}",
                    )
            elif not download_url:
                messagebox.showinfo("Project Relay update", message)
        else:
            messagebox.showinfo(
                "Project Relay update",
                f"You are up to date.\n\nInstalled: {__version__}\nLatest beta: {version}",
            )

    def pair_account(self):
        try:
            result = request_pairing_code()
        except Exception as exc:
            messagebox.showerror("Project Relay", f"Could not create pairing code.\n\n{exc}")
            return

        code = str(result.get("code") or "")
        expires = str(result.get("expires_at") or "")
        account_url = str(result.get("account_url") or "")
        self.clipboard_clear()
        self.clipboard_append(code)
        self.update()

        message = f"Pairing code: {code}\n\nCopied to the clipboard.\nExpires: {expires}"
        if account_url:
            message += "\n\nOpen the Project Relay account page now?"
            if messagebox.askyesno("Project Relay account pairing", message):
                webbrowser.open(account_url)
        else:
            messagebox.showinfo("Project Relay account pairing", message)

    def approve_selected(self):
        selected = self.approval_tree.selection()
        if not selected:
            messagebox.showinfo("Project Relay", "Select an approval first.")
            return
        approval_id = selected[0]
        try:
            record = self.store.get(approval_id)
        except (KeyError, ValueError, OSError):
            messagebox.showerror("Project Relay", "This request is no longer available. Refresh and try again.")
            return
        yes = messagebox.askyesno("Approve exact action?", f"{record.summary}\n\nDevice: {record.device_id}\nAction: {record.action}\n\nApprove this exact request?")
        if not yes:
            return
        try:
            self.store.approve(approval_id)
        except (KeyError, ValueError, OSError, TimeoutError):
            messagebox.showerror("Project Relay", "Approval could not be granted. The request may have expired. Ask for a new request.")
        self.refresh_all()


def main() -> int:
    RelayWindow().mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

