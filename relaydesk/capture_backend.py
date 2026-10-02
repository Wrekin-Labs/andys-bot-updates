from __future__ import annotations

import platform
from dataclasses import dataclass
from typing import Literal

from PIL import Image

CaptureChoice = Literal["auto", "dxgi", "mss"]


@dataclass(frozen=True)
class CaptureInfo:
    backend: str
    monitor: int


def resolve_backend(choice: CaptureChoice, monitor: int, system: str | None = None) -> str:
    system = system or platform.system()
    if choice == "mss":
        return "mss"
    if choice == "dxgi":
        if system != "Windows":
            raise RuntimeError("DXGI capture is only available on Windows")
        if monitor == 0:
            raise RuntimeError("DXGI alpha capture selects one output; use --capture mss for monitor 0 virtual desktop")
        return "dxgi"
    if choice == "auto":
        if system == "Windows" and monitor > 0:
            return "dxgi"
        return "mss"
    raise ValueError(f"unknown capture backend: {choice}")


def monitor_catalog() -> list[dict[str, int]]:
    import mss

    with mss.mss() as sct:
        monitors = list(sct.monitors)
    return [
        {
            "index": i,
            "left": int(mon["left"]),
            "top": int(mon["top"]),
            "width": int(mon["width"]),
            "height": int(mon["height"]),
        }
        for i, mon in enumerate(monitors)
    ]


class MSSCapture:
    def __init__(self, monitor: int):
        import mss

        self._mss_module = mss
        self._monitor_index = monitor
        self._sct = None
        self._monitor = None

    @property
    def info(self) -> CaptureInfo:
        return CaptureInfo("mss", self._monitor_index)

    def __enter__(self) -> "MSSCapture":
        self._sct = self._mss_module.mss()
        monitors = list(self._sct.monitors)
        if self._monitor_index < 0 or self._monitor_index >= len(monitors):
            self._sct.close()
            self._sct = None
            raise RuntimeError(f"invalid monitor {self._monitor_index}; available 0..{len(monitors)-1}")
        self._monitor = monitors[self._monitor_index]
        return self

    def grab(self) -> Image.Image:
        if self._sct is None or self._monitor is None:
            raise RuntimeError("capture backend is not open")
        shot = self._sct.grab(self._monitor)
        return Image.frombytes("RGB", shot.size, shot.rgb)

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._sct is not None:
            self._sct.close()
        self._sct = None
        self._monitor = None


class DXGICapture:
    def __init__(self, monitor: int):
        self._monitor_index = monitor
        self._camera = None

    @property
    def info(self) -> CaptureInfo:
        return CaptureInfo("dxgi", self._monitor_index)

    def __enter__(self) -> "DXGICapture":
        try:
            import dxcam
        except ImportError as exc:
            raise RuntimeError(
                "DXGI capture requested but dxcam is not installed. Install requirements-host.txt."
            ) from exc
        # RelayDesk monitor 1 maps to DXCam output 0.
        self._camera = dxcam.create(
            device_idx=0,
            output_idx=self._monitor_index - 1,
            output_color="RGB",
            processor_backend="numpy",
            backend="dxgi",
        )
        return self

    def grab(self) -> Image.Image | None:
        if self._camera is None:
            raise RuntimeError("capture backend is not open")
        frame = self._camera.grab(new_frame_only=False)
        if frame is None:
            return None
        return Image.fromarray(frame, mode="RGB")

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._camera is not None:
            self._camera.release()
        self._camera = None


class AutoCapture:
    def __init__(self, monitor: int):
        self._monitor_index = monitor
        self._active = None

    @property
    def info(self) -> CaptureInfo:
        if self._active is None:
            return CaptureInfo("auto", self._monitor_index)
        return self._active.info

    def __enter__(self):
        try:
            self._active = DXGICapture(self._monitor_index)
            self._active.__enter__()
        except Exception:
            self._active = MSSCapture(self._monitor_index)
            self._active.__enter__()
        return self

    def grab(self) -> Image.Image | None:
        if self._active is None:
            raise RuntimeError("capture backend is not open")
        return self._active.grab()

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._active is not None:
            self._active.__exit__(exc_type, exc, tb)
        self._active = None


def create_capture(choice: CaptureChoice, monitor: int):
    selected = resolve_backend(choice, monitor)
    if choice == "auto" and selected == "dxgi":
        return AutoCapture(monitor)
    if selected == "dxgi":
        return DXGICapture(monitor)
    return MSSCapture(monitor)
