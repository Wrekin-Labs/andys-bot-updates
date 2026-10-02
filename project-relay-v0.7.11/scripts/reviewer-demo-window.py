from __future__ import annotations

import tkinter as tk
from tkinter import ttk


def main() -> None:
    root = tk.Tk()
    root.title("Project Relay Reviewer Test")
    root.geometry("620x340")
    root.minsize(620, 340)

    outer = ttk.Frame(root, padding=24)
    outer.pack(fill="both", expand=True)

    ttk.Label(
        outer,
        text="Project Relay reviewer fixture",
        font=("Segoe UI", 18, "bold"),
    ).pack(anchor="w")
    ttk.Label(
        outer,
        text=(
            "This disposable window exists only for safe screenshot, click and typing "
            "tests. It does not open files, run commands or access hardware."
        ),
        wraplength=560,
    ).pack(anchor="w", pady=(8, 18))

    state = tk.StringVar(value="READY")
    ttk.Label(outer, textvariable=state, font=("Consolas", 15, "bold")).pack(anchor="w")

    def clicked() -> None:
        state.set("CLICKED")

    ttk.Button(outer, text="Relay test button", command=clicked).pack(anchor="w", pady=(14, 16))

    ttk.Label(outer, text="Test text field:").pack(anchor="w")
    entry = ttk.Entry(outer, width=64)
    entry.pack(anchor="w", pady=(5, 8))

    mirror = tk.StringVar(value="")
    ttk.Label(outer, textvariable=mirror, font=("Consolas", 11)).pack(anchor="w")

    def update(*_: object) -> None:
        mirror.set("TEXT: " + entry.get())

    entry.bind("<KeyRelease>", update)

    ttk.Label(
        outer,
        text="Expected reviewer test: screenshot → click button → type text → screenshot.",
    ).pack(anchor="w", pady=(22, 0))

    root.mainloop()


if __name__ == "__main__":
    main()
